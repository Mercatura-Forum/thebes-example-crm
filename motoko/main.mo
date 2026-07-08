import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Runtime "mo:core/Runtime";
import Result "mo:core/Result";
import Admin "mo:thebes-lib/Admin";
import Pagination "mo:thebes-lib/Pagination";

// CRM for an SME sales team. Every non-anonymous caller is a sales rep: a rep
// owns the contacts and deals it creates. The Admin tier is the MANAGER role
// (owner + granted admins) — a manager sees and can reassign across the whole
// book; a rep is confined to its own records.
//
// Correctness guards (the real ones):
//   1. FORWARD-ONLY PIPELINE. A deal advances #lead -> #qualified -> #proposal
//      -> {#won | #lost}; #won and #lost are terminal. Backward or skipping
//      transitions are rejected, so pipeline analytics can trust the stage.
//   2. PER-REP OWNERSHIP. A rep may only read/mutate the contacts and deals it
//      owns; the manager (admin) is the sole exception and the only role that
//      can reassign a contact to another rep.
//
// Media: each contact may carry a photo pointer (`photoPath`) into the media
// contract; the bytes live there, never here (the storage law).
persistent actor CRM {

  // Admin tier = MANAGER role (owner + admins) + emergency pause.
  var admin = Admin.init();

  public shared(msg) func claimOwner() : async Bool {
    if (Principal.isAnonymous(msg.caller)) Runtime.trap("anonymous caller");
    Admin.claimOwner(admin, msg.caller)
  };
  public shared(msg) func transferOwner(n : Principal) : async Bool { Admin.transferOwner(admin, msg.caller, n) };
  public shared(msg) func addAdmin(w : Principal) : async Bool { Admin.addAdmin(admin, msg.caller, w) };
  public shared(msg) func removeAdmin(w : Principal) : async Bool { Admin.removeAdmin(admin, msg.caller, w) };
  public shared(msg) func setPaused(v : Bool) : async Bool { Admin.setPaused(admin, msg.caller, v) };
  public query func getOwner() : async ?Principal { Admin.getOwner(admin) };
  public query func getAdmins() : async [Principal] { Admin.getAdmins(admin) };
  public query func isPaused() : async Bool { Admin.isPaused(admin) };

  public type Contact = {
    id : Nat;
    name : Text;
    company : Text;
    email : Text;
    phone : Text;
    photoPath : ?Text;
    ownerRep : Principal;
    createdAt : Int;
  };

  public type Stage = { #lead; #qualified; #proposal; #won; #lost };

  public type Deal = {
    id : Nat;
    contactId : Nat;
    title : Text;
    valueCents : Nat;
    stage : Stage;
    ownerRep : Principal;
    createdAt : Int;
    closedAt : ?Int;
  };

  public type ActivityKind = { #note; #call; #email; #meeting };

  public type Activity = {
    id : Nat;
    contactId : Nat;
    kind : ActivityKind;
    body : Text;
    by : Principal;
    at : Int;
  };

  // Every stage a deal has ever entered, append-only — the pipeline's audit
  // trail. Replaying a deal's history from #lead through only-legal
  // transitions must land exactly on its current stage; the public oracle
  // re-proves that for the whole book on every read.
  public type StageEvent = {
    seq : Nat;
    dealId : Nat;
    from : Stage;
    to : Stage;
    by : Principal;
    at : Int;
    note : Text; // e.g. the lost reason; "" when none
  };

  var nextContactId : Nat = 0;
  var nextDealId : Nat = 0;
  var nextActivityId : Nat = 0;
  var nextStageSeq : Nat = 0;

  let contacts = Map.empty<Nat, Contact>();
  let deals = Map.empty<Nat, Deal>();
  let activities = Map.empty<Nat, Activity>();
  let dealHistory = Map.empty<Nat, List.List<StageEvent>>();

  func historyOf(dealId : Nat) : List.List<StageEvent> {
    switch (Map.get(dealHistory, Nat.compare, dealId)) {
      case (?l) l;
      case null { let l = List.empty<StageEvent>(); Map.add(dealHistory, Nat.compare, dealId, l); l };
    };
  };
  func pushHistory(dealId : Nat, from : Stage, to : Stage, by : Principal, note : Text) {
    List.add(historyOf(dealId), { seq = nextStageSeq; dealId; from; to; by; at = Time.now(); note });
    nextStageSeq += 1;
  };

  // A manager (admin) reaches everything; a rep reaches only what it owns.
  private func canReach(caller : Principal, ownerRep : Principal) : Bool {
    Admin.isAdmin(admin, caller) or Principal.equal(ownerRep, caller);
  };

  // Load a contact the caller may reach, or trap. Used by deal/activity writes
  // that must verify the caller owns (or manages) the contact first.
  private func reachableContact(caller : Principal, contactId : Nat) : Contact {
    switch (Map.get(contacts, Nat.compare, contactId)) {
      case null { Runtime.trap("contact not found") };
      case (?c) { if (not canReach(caller, c.ownerRep)) Runtime.trap("not your contact"); c };
    };
  };

  // No-auth core: append a contact owned by `caller`. Shared by the gated public
  // method and by seedDemo (which seeds the caller's own slice).
  private func doAddContact(caller : Principal, name : Text, company : Text, email : Text, phone : Text, photoPath : ?Text) : Nat {
    let id = nextContactId;
    nextContactId += 1;
    let c : Contact = { id; name; company; email; phone; photoPath; ownerRep = caller; createdAt = Time.now() };
    Map.add(contacts, Nat.compare, id, c);
    id;
  };

  // Create a contact owned by the caller (the rep).
  public shared(msg) func addContact(name : Text, company : Text, email : Text, phone : Text, photoPath : ?Text) : async Nat {
    Admin.requireNotPaused(admin);
    if (Principal.isAnonymous(msg.caller)) Runtime.trap("anonymous caller");
    doAddContact(msg.caller, name, company, email, phone, photoPath);
  };

  private func doSetContactPhoto(caller : Principal, contactId : Nat, photoPath : Text) : Result.Result<(), Text> {
    Admin.requireNotPaused(admin);
    switch (Map.get(contacts, Nat.compare, contactId)) {
      case null { #err("Contact not found") };
      case (?c) {
        if (not canReach(caller, c.ownerRep)) return #err("not your contact");
        Map.add(contacts, Nat.compare, contactId, { c with photoPath = ?photoPath });
        #ok(());
      };
    };
  };

  // Owner-rep or manager: set/replace the contact photo (uploaded to the media
  // contract first → "/photo/{hash}").
  public shared(msg) func setContactPhoto(contactId : Nat, photoPath : Text) : async Result.Result<(), Text> {
    doSetContactPhoto(msg.caller, contactId, photoPath);
  };

  // Trap-on-error twin: traps the error message (e.g. "not your contact") so a
  // frontend gets a clean success/failure.
  public shared(msg) func setContactPhotoOrTrap(contactId : Nat, photoPath : Text) : async () {
    switch (doSetContactPhoto(msg.caller, contactId, photoPath)) { case (#ok(())) {}; case (#err(e)) { Runtime.trap(e) } };
  };

  // GUARD 2 (per-rep visibility): one contact, only if the caller owns or
  // manages it (else null — never leaks another rep's contact).
  public shared query(msg) func getContact(contactId : Nat) : async ?Contact {
    switch (Map.get(contacts, Nat.compare, contactId)) {
      case null { null };
      case (?c) { if (canReach(msg.caller, c.ownerRep)) ?c else null };
    };
  };

  // The caller's own contacts (a manager still sees only its own here; use
  // listAllContacts for the whole book), newest-first, paginated.
  public shared query(msg) func listMyContacts(offset : Nat, limit : Nat) : async Pagination.Page<Contact> {
    let mine = Array.filter(Iter.toArray(Map.values(contacts)), func(c : Contact) : Bool { Principal.equal(c.ownerRep, msg.caller) });
    let sorted = Array.sort(mine, func(a : Contact, b : Contact) : { #less; #equal; #greater } { Int.compare(b.createdAt, a.createdAt) });
    Pagination.page<Contact>(sorted, offset, limit);
  };

  // Manager-only: the whole contact book, paginated. Returns an empty page to
  // non-managers.
  public shared query(msg) func listAllContacts(offset : Nat, limit : Nat) : async Pagination.Page<Contact> {
    if (not Admin.isAdmin(admin, msg.caller)) return { items = []; nextOffset = null; total = 0 };
    let all = Iter.toArray(Map.values(contacts));
    let sorted = Array.sort(all, func(a : Contact, b : Contact) : { #less; #equal; #greater } { Int.compare(b.createdAt, a.createdAt) });
    Pagination.page<Contact>(sorted, offset, limit);
  };

  // Manager-only: reassign a contact (and is the only way ownership moves).
  public shared(msg) func reassignContact(contactId : Nat, newRep : Principal) : async Result.Result<(), Text> {
    Admin.requireNotPaused(admin);
    if (not Admin.isAdmin(admin, msg.caller)) return #err("Not authorized");
    if (Principal.isAnonymous(newRep)) return #err("cannot assign to anonymous");
    switch (Map.get(contacts, Nat.compare, contactId)) {
      case null { #err("Contact not found") };
      case (?c) { Map.add(contacts, Nat.compare, contactId, { c with ownerRep = newRep }); #ok(()) };
    };
  };

  private func doAddDeal(caller : Principal, contactId : Nat, title : Text, valueCents : Nat) : Result.Result<Nat, Text> {
    Admin.requireNotPaused(admin);
    let _ = reachableContact(caller, contactId); // traps if not reachable
    let id = nextDealId;
    nextDealId += 1;
    let d : Deal = { id; contactId; title; valueCents; stage = #lead; ownerRep = caller; createdAt = Time.now(); closedAt = null };
    Map.add(deals, Nat.compare, id, d);
    // The opening event: a deal is born into #lead, on the record.
    pushHistory(id, #lead, #lead, caller, "opened");
    #ok(id);
  };

  // Open a deal against a contact the caller may reach; the deal starts at #lead
  // and is owned by the caller.
  public shared(msg) func addDeal(contactId : Nat, title : Text, valueCents : Nat) : async Result.Result<Nat, Text> {
    doAddDeal(msg.caller, contactId, title, valueCents);
  };

  public shared(msg) func addDealOrTrap(contactId : Nat, title : Text, valueCents : Nat) : async Nat {
    switch (doAddDeal(msg.caller, contactId, title, valueCents)) { case (#ok(id)) { id }; case (#err(e)) { Runtime.trap(e) } };
  };

  // Forward-only pipeline: each stage may only move to the next, and #won/#lost
  // are terminal. A deal in #lead/#qualified/#proposal may also jump straight to
  // #lost (deals die at any open stage) — but never backward and never out of a
  // closed stage.
  private func validTransition(from : Stage, to : Stage) : Bool {
    switch (from, to) {
      case (#lead, #qualified) { true };
      case (#qualified, #proposal) { true };
      case (#proposal, #won) { true };
      case (#lead, #lost) { true };
      case (#qualified, #lost) { true };
      case (#proposal, #lost) { true };
      case _ { false };
    };
  };

  // GUARD 1 (forward-only pipeline) + GUARD 2 (owner-rep/manager only): advance
  // a deal's stage. Reaching #won or #lost stamps closedAt in the same call.
  // `newStage` is passed as text ("qualified"|"proposal"|"won"|"lost") — the SPA
  // can't encode Candid variants, so we parse to Stage at the boundary.
  private func doAdvanceDeal(caller : Principal, dealId : Nat, stageText : Text, note : Text) : Result.Result<(), Text> {
    Admin.requireNotPaused(admin);
    let newStage = stageOf(stageText);
    switch (Map.get(deals, Nat.compare, dealId)) {
      case null { #err("Deal not found") };
      case (?d) {
        if (not canReach(caller, d.ownerRep)) return #err("not your deal");
        if (not validTransition(d.stage, newStage)) return #err("invalid stage transition");
        let closedAt = switch (newStage) { case (#won or #lost) { ?Time.now() }; case _ { d.closedAt } };
        Map.add(deals, Nat.compare, dealId, { d with stage = newStage; closedAt });
        pushHistory(dealId, d.stage, newStage, caller, note);
        #ok(());
      };
    };
  };

  public shared(msg) func advanceDeal(dealId : Nat, stageText : Text, note : Text) : async Result.Result<(), Text> {
    doAdvanceDeal(msg.caller, dealId, stageText, note);
  };

  public shared(msg) func advanceDealOrTrap(dealId : Nat, stageText : Text, note : Text) : async () {
    switch (doAdvanceDeal(msg.caller, dealId, stageText, note)) { case (#ok(())) {}; case (#err(e)) { Runtime.trap(e) } };
  };

  // Deals on a contact the caller may reach (else trap), newest-first.
  public shared query(msg) func getDeals(contactId : Nat) : async [Deal] {
    let _ = reachableContact(msg.caller, contactId);
    let ds = Array.filter(Iter.toArray(Map.values(deals)), func(d : Deal) : Bool { d.contactId == contactId });
    Array.sort(ds, func(a : Deal, b : Deal) : { #less; #equal; #greater } { Int.compare(b.createdAt, a.createdAt) });
  };

  // Append an activity to a contact the caller may reach. Activities are an
  // append-only log (no edit/delete) so the audit trail is immutable.
  private func doLogActivity(caller : Principal, contactId : Nat, kindText : Text, body : Text) : Result.Result<Nat, Text> {
    Admin.requireNotPaused(admin);
    let kind = activityKindOf(kindText);
    let _ = reachableContact(caller, contactId);
    let id = nextActivityId;
    nextActivityId += 1;
    let a : Activity = { id; contactId; kind; body; by = caller; at = Time.now() };
    Map.add(activities, Nat.compare, id, a);
    #ok(id);
  };

  public shared(msg) func logActivity(contactId : Nat, kindText : Text, body : Text) : async Result.Result<Nat, Text> {
    doLogActivity(msg.caller, contactId, kindText, body);
  };

  public shared(msg) func logActivityOrTrap(contactId : Nat, kindText : Text, body : Text) : async Nat {
    switch (doLogActivity(msg.caller, contactId, kindText, body)) { case (#ok(id)) { id }; case (#err(e)) { Runtime.trap(e) } };
  };

  // Activity log for a contact the caller may reach, newest-first, paginated.
  public shared query(msg) func getActivities(contactId : Nat, offset : Nat, limit : Nat) : async Pagination.Page<Activity> {
    let _ = reachableContact(msg.caller, contactId);
    let acts = Array.filter(Iter.toArray(Map.values(activities)), func(a : Activity) : Bool { a.contactId == contactId });
    let sorted = Array.sort(acts, func(a : Activity, b : Activity) : { #less; #equal; #greater } { Int.compare(b.at, a.at) });
    Pagination.page<Activity>(sorted, offset, limit);
  };

  // Pipeline summary for the caller's own book (a manager passing allReps=true
  // gets the whole team's). Open value sums non-terminal deals; won value sums
  // #won; counts per terminal outcome let a UI render conversion.
  public shared query(msg) func getPipeline(allReps : Bool) : async {
    openCount : Nat; openValueCents : Nat; wonCount : Nat; wonValueCents : Nat; lostCount : Nat;
  } {
    let scopeAll = allReps and Admin.isAdmin(admin, msg.caller);
    var openCount : Nat = 0; var openValueCents : Nat = 0;
    var wonCount : Nat = 0; var wonValueCents : Nat = 0; var lostCount : Nat = 0;
    for (d in Map.values(deals)) {
      if (scopeAll or Principal.equal(d.ownerRep, msg.caller)) {
        switch (d.stage) {
          case (#won) { wonCount += 1; wonValueCents += d.valueCents };
          case (#lost) { lostCount += 1 };
          case _ { openCount += 1; openValueCents += d.valueCents };
        };
      };
    };
    { openCount; openValueCents; wonCount; wonValueCents; lostCount };
  };

  // Seed the CALLER's own book (per-rep) so a freshly-deployed CRM is alive for
  // each new rep. No-op if this rep already owns any contact. Photos are seeded
  // empty (the bytes live on the media contract, content-addressed by upload).
  public shared(msg) func seedDemo() : async Bool {
    Admin.requireNotPaused(admin);
    if (Principal.isAnonymous(msg.caller)) Runtime.trap("Sign in to load demo data");
    let hasOwn = Array.filter(Iter.toArray(Map.values(contacts)), func(c : Contact) : Bool { Principal.equal(c.ownerRep, msg.caller) }).size() > 0;
    if (hasOwn) return false;

    let c1 = doAddContact(msg.caller, "Dana Okonkwo", "Lumen Health", "dana@lumenhealth.io", "+1 415 555 0142", null);
    let c2 = doAddContact(msg.caller, "Marco Ferreira", "Atlas Logistics", "marco@atlaslog.co", "+1 312 555 0188", null);
    let c3 = doAddContact(msg.caller, "Priya Raman", "Northwind Retail", "priya@northwind.com", "+1 206 555 0173", null);

    let c4 = doAddContact(msg.caller, "Elena Vasquez", "Cobalt Systems", "elena@cobaltsys.dev", "+1 646 555 0117", null);

    let d1 = switch (doAddDeal(msg.caller, c1, "Enterprise rollout", 4800000)) { case (#ok(id)) { id }; case (#err(_)) { 0 } };
    ignore doAdvanceDeal(msg.caller, d1, "qualified", "Budget confirmed on the intro call");
    let d2 = switch (doAddDeal(msg.caller, c2, "Fleet integration", 1250000)) { case (#ok(id)) { id }; case (#err(_)) { 0 } };
    ignore doAdvanceDeal(msg.caller, d2, "qualified", "Spec accepted");
    ignore doAdvanceDeal(msg.caller, d2, "proposal", "Proposal sent with Q3 pricing");
    ignore doAddDeal(msg.caller, c3, "Pilot program", 320000);
    let d4 = switch (doAddDeal(msg.caller, c4, "Analytics add-on", 780000)) { case (#ok(id)) { id }; case (#err(_)) { 0 } };
    ignore doAdvanceDeal(msg.caller, d4, "qualified", "");
    ignore doAdvanceDeal(msg.caller, d4, "proposal", "");
    ignore doAdvanceDeal(msg.caller, d4, "won", "Signed a 12-month term");
    let d5 = switch (doAddDeal(msg.caller, c4, "Legacy migration", 450000)) { case (#ok(id)) { id }; case (#err(_)) { 0 } };
    ignore doAdvanceDeal(msg.caller, d5, "lost", "Went with the incumbent vendor");

    ignore doLogActivity(msg.caller, c1, "call", "Intro call — strong interest in the analytics module.");
    ignore doLogActivity(msg.caller, c2, "email", "Sent integration spec and pricing deck.");
    ignore doLogActivity(msg.caller, c3, "meeting", "On-site demo scheduled for next week.");
    ignore doLogActivity(msg.caller, c4, "note", "Renewal window opens in Q4 — set a reminder.");
    true;
  };

  // ── Variant <-> text (the SPA can't encode/decode Candid variants) ──
  func stageOf(s : Text) : Stage {
    switch s { case ("qualified") #qualified; case ("proposal") #proposal; case ("won") #won; case ("lost") #lost; case _ #lead };
  };
  func stageTextOf(s : Stage) : Text {
    switch s { case (#lead) "lead"; case (#qualified) "qualified"; case (#proposal) "proposal"; case (#won) "won"; case (#lost) "lost" };
  };
  func activityKindOf(s : Text) : ActivityKind {
    switch s { case ("call") #call; case ("email") #email; case ("meeting") #meeting; case _ #note };
  };
  func activityKindTextOf(k : ActivityKind) : Text {
    switch k { case (#note) "note"; case (#call) "call"; case (#email) "email"; case (#meeting) "meeting" };
  };

  // ── Frontend view-models (flat records — easy to decode in the SPA) ──
  func reachable(caller : Principal, contactId : Nat) : Bool {
    switch (Map.get(contacts, Nat.compare, contactId)) { case (?c) canReach(caller, c.ownerRep); case null false };
  };

  public shared query(msg) func myContactsView() : async [{ id : Nat; name : Text; company : Text; email : Text; phone : Text; photoPath : Text; createdAt : Int }] {
    let mine = Array.filter(Iter.toArray(Map.values(contacts)), func(c : Contact) : Bool { Principal.equal(c.ownerRep, msg.caller) });
    let sorted = Array.sort(mine, func(a : Contact, b : Contact) : { #less; #equal; #greater } { Int.compare(b.createdAt, a.createdAt) });
    Array.map<Contact, { id : Nat; name : Text; company : Text; email : Text; phone : Text; photoPath : Text; createdAt : Int }>(
      sorted, func(c) { { id = c.id; name = c.name; company = c.company; email = c.email; phone = c.phone; createdAt = c.createdAt; photoPath = (switch (c.photoPath) { case (?p) p; case null "" }) } },
    )
  };

  public shared query(msg) func dealsView(contactId : Nat) : async [{ id : Nat; contactId : Nat; title : Text; valueCents : Nat; stage : Text; createdAt : Int }] {
    if (not reachable(msg.caller, contactId)) return [];
    let ds = Array.filter(Iter.toArray(Map.values(deals)), func(d : Deal) : Bool { d.contactId == contactId });
    let sorted = Array.sort(ds, func(a : Deal, b : Deal) : { #less; #equal; #greater } { Int.compare(b.createdAt, a.createdAt) });
    Array.map<Deal, { id : Nat; contactId : Nat; title : Text; valueCents : Nat; stage : Text; createdAt : Int }>(
      sorted, func(d) { { id = d.id; contactId = d.contactId; title = d.title; valueCents = d.valueCents; stage = stageTextOf(d.stage); createdAt = d.createdAt } },
    )
  };

  // All the caller's deals (across contacts) with the contact name joined — the
  // data the pipeline kanban groups by stage.
  public shared query(msg) func myDealsView() : async [{ id : Nat; contactId : Nat; contactName : Text; title : Text; valueCents : Nat; stage : Text; createdAt : Int }] {
    let mine = Array.filter(Iter.toArray(Map.values(deals)), func(d : Deal) : Bool { Principal.equal(d.ownerRep, msg.caller) });
    let sorted = Array.sort(mine, func(a : Deal, b : Deal) : { #less; #equal; #greater } { Int.compare(b.createdAt, a.createdAt) });
    Array.map<Deal, { id : Nat; contactId : Nat; contactName : Text; title : Text; valueCents : Nat; stage : Text; createdAt : Int }>(
      sorted, func(d) {
        let nm = switch (Map.get(contacts, Nat.compare, d.contactId)) { case (?c) c.name; case null "(deleted)" };
        { id = d.id; contactId = d.contactId; contactName = nm; title = d.title; valueCents = d.valueCents; stage = stageTextOf(d.stage); createdAt = d.createdAt }
      },
    )
  };

  public shared query(msg) func activitiesView(contactId : Nat) : async [{ id : Nat; contactId : Nat; kind : Text; body : Text; by : Principal; at : Int }] {
    if (not reachable(msg.caller, contactId)) return [];
    let acts = Array.filter(Iter.toArray(Map.values(activities)), func(a : Activity) : Bool { a.contactId == contactId });
    let sorted = Array.sort(acts, func(a : Activity, b : Activity) : { #less; #equal; #greater } { Int.compare(b.at, a.at) });
    Array.map<Activity, { id : Nat; contactId : Nat; kind : Text; body : Text; by : Principal; at : Int }>(
      sorted, func(a) { { id = a.id; contactId = a.contactId; kind = activityKindTextOf(a.kind); body = a.body; by = a.by; at = a.at } },
    )
  };

  public shared query(msg) func pipelineView(allReps : Bool) : async [{ openCount : Nat; openValueCents : Nat; wonCount : Nat; wonValueCents : Nat; lostCount : Nat }] {
    let scopeAll = allReps and Admin.isAdmin(admin, msg.caller);
    var openCount : Nat = 0; var openValueCents : Nat = 0;
    var wonCount : Nat = 0; var wonValueCents : Nat = 0; var lostCount : Nat = 0;
    for (d in Map.values(deals)) {
      if (scopeAll or Principal.equal(d.ownerRep, msg.caller)) {
        switch (d.stage) {
          case (#won) { wonCount += 1; wonValueCents += d.valueCents };
          case (#lost) { lostCount += 1 };
          case _ { openCount += 1; openValueCents += d.valueCents };
        };
      };
    };
    [{ openCount; openValueCents; wonCount; wonValueCents; lostCount }]
  };

  // A deal's full stage trail (only if the caller may reach the deal).
  public shared query(msg) func dealHistoryView(dealId : Nat) : async [{
    seq : Nat; dealId : Nat; from : Text; to : Text; by : Principal; at : Int; note : Text;
  }] {
    switch (Map.get(deals, Nat.compare, dealId)) {
      case null [];
      case (?d) {
        if (not canReach(msg.caller, d.ownerRep)) return [];
        Array.map<StageEvent, { seq : Nat; dealId : Nat; from : Text; to : Text; by : Principal; at : Int; note : Text }>(
          List.toArray(historyOf(dealId)),
          func(e) { { seq = e.seq; dealId = e.dealId; from = stageTextOf(e.from); to = stageTextOf(e.to); by = e.by; at = e.at; note = e.note } },
        );
      };
    };
  };

  // Per stage, two readings of the caller's book (manager + allReps=true →
  // the team's): what sits AT the stage now, and what has ever REACHED it
  // (from the history trail). The reached numbers taper monotonically — they
  // are the true conversion funnel the hero ribbon draws.
  public shared query(msg) func funnelView(allReps : Bool) : async [{
    stage : Text; count : Nat; valueCents : Nat; reachedCount : Nat; reachedValueCents : Nat;
  }] {
    let scopeAll = allReps and Admin.isAdmin(admin, msg.caller);
    let stages : [Stage] = [#lead, #qualified, #proposal, #won, #lost];
    Array.map<Stage, { stage : Text; count : Nat; valueCents : Nat; reachedCount : Nat; reachedValueCents : Nat }>(stages, func(s) {
      var count : Nat = 0; var value : Nat = 0;
      var rCount : Nat = 0; var rValue : Nat = 0;
      for (d in Map.values(deals)) {
        if (scopeAll or Principal.equal(d.ownerRep, msg.caller)) {
          if (d.stage == s) { count += 1; value += d.valueCents };
          var reached = s == #lead; // every deal opens at lead
          for (e in List.values(historyOf(d.id))) { if (e.to == s) reached := true };
          if (reached) { rCount += 1; rValue += d.valueCents };
        };
      };
      { stage = stageTextOf(s); count; valueCents = value; reachedCount = rCount; reachedValueCents = rValue };
    });
  };

  // Weighted forecast over the open book: lead 10%, qualified 30%, proposal
  // 60% (classic stage-probability model). All-Nat math in cents.
  func stageBps(s : Stage) : Nat {
    switch (s) { case (#lead) 1_000; case (#qualified) 3_000; case (#proposal) 6_000; case _ 0 };
  };
  public shared query(msg) func forecastView(allReps : Bool) : async [{
    weightedCents : Nat; openCents : Nat; openCount : Nat; wonCents : Nat; nowNs : Int;
  }] {
    let scopeAll = allReps and Admin.isAdmin(admin, msg.caller);
    var weighted : Nat = 0; var open : Nat = 0; var openCount : Nat = 0; var won : Nat = 0;
    for (d in Map.values(deals)) {
      if (scopeAll or Principal.equal(d.ownerRep, msg.caller)) {
        switch (d.stage) {
          case (#won) { won += d.valueCents };
          case (#lost) {};
          case (s) { open += d.valueCents; openCount += 1; weighted += d.valueCents * stageBps(s) / 10_000 };
        };
      };
    };
    [{ weightedCents = weighted; openCents = open; openCount; wonCents = won; nowNs = Time.now() }];
  };

  // ── The oracle: four laws over the whole book, recomputable by anyone ────
  //   R1 history-replay  — replaying a deal's trail from #lead through only
  //                        legal transitions lands exactly on its stage
  //   R2 terminal-closure— won/lost stamps closedAt and nothing moves after
  //   R3 referential     — every deal & activity points at a real contact
  //   R4 census          — open + won + lost == every deal on the book
  public query func invariantReportView() : async [{ rule : Text; detail : Text }] {
    let bad = List.empty<{ rule : Text; detail : Text }>();

    for ((id, d) in Map.entries(deals)) {
      let trail = List.toArray(historyOf(id));
      if (trail.size() == 0) {
        List.add(bad, { rule = "R1 history"; detail = "deal #" # Nat.toText(id) # " has no opening event" });
      } else {
        if (trail[0].to != #lead or trail[0].from != #lead) {
          List.add(bad, { rule = "R1 history"; detail = "deal #" # Nat.toText(id) # " does not open at lead" });
        };
        var cur : Stage = #lead;
        var i = 1;
        var ok = true;
        while (i < trail.size()) {
          if (trail[i].at < trail[i - 1].at) {
            List.add(bad, { rule = "R1 order"; detail = "deal #" # Nat.toText(id) # " trail is not time-ordered at seq " # Nat.toText(trail[i].seq) });
          };
          if (trail[i].from != cur or not validTransition(cur, trail[i].to)) {
            List.add(bad, { rule = "R1 replay"; detail = "deal #" # Nat.toText(id) # " has an illegal transition at seq " # Nat.toText(trail[i].seq) });
            ok := false;
          };
          cur := trail[i].to;
          i += 1;
        };
        if (ok and cur != d.stage) {
          List.add(bad, { rule = "R1 replay"; detail = "deal #" # Nat.toText(id) # " trail replays to " # stageTextOf(cur) # " but the book says " # stageTextOf(d.stage) });
        };
      };
      switch (d.stage) {
        case (#won or #lost) {
          if (d.closedAt == null) List.add(bad, { rule = "R2 closure"; detail = "deal #" # Nat.toText(id) # " is closed without a closedAt stamp" });
        };
        case _ {
          if (d.closedAt != null) List.add(bad, { rule = "R2 closure"; detail = "deal #" # Nat.toText(id) # " is open but carries a closedAt stamp" });
        };
      };
      if (Map.get(contacts, Nat.compare, d.contactId) == null) {
        List.add(bad, { rule = "R3 referential"; detail = "deal #" # Nat.toText(id) # " points at a missing contact" });
      };
    };

    for ((id, a) in Map.entries(activities)) {
      if (Map.get(contacts, Nat.compare, a.contactId) == null) {
        List.add(bad, { rule = "R3 referential"; detail = "activity #" # Nat.toText(id) # " points at a missing contact" });
      };
    };

    var open : Nat = 0; var won : Nat = 0; var lost : Nat = 0;
    for (d in Map.values(deals)) {
      switch (d.stage) { case (#won) won += 1; case (#lost) lost += 1; case _ open += 1 };
    };
    if (open + won + lost != Map.size(deals)) {
      List.add(bad, { rule = "R4 census"; detail = "stage counts do not sum to the book" });
    };

    List.toArray(bad);
  };

  // One row for the footer seal.
  public query func crmSealView() : async [{
    contacts : Nat; deals : Nat; activities : Nat; transitions : Nat; violations : Nat; checkedAt : Int;
  }] {
    var trans : Nat = 0;
    for ((_, l) in Map.entries(dealHistory)) { trans += List.size(l) };
    let v = violationsCount();
    [{ contacts = Map.size(contacts); deals = Map.size(deals); activities = Map.size(activities); transitions = trans; violations = v; checkedAt = Time.now() }];
  };
  // Cheap violation count for the seal (the full report is public anyway).
  func violationsCount() : Nat {
    var n : Nat = 0;
    for ((id, d) in Map.entries(deals)) {
      let trail = List.toArray(historyOf(id));
      var cur : Stage = #lead;
      var i = 1;
      var bad = trail.size() == 0;
      while (i < trail.size()) {
        if (trail[i].from != cur or not validTransition(cur, trail[i].to)) bad := true;
        cur := trail[i].to;
        i += 1;
      };
      if (trail.size() > 0 and cur != d.stage) bad := true;
      switch (d.stage) {
        case (#won or #lost) { if (d.closedAt == null) bad := true };
        case _ { if (d.closedAt != null) bad := true };
      };
      if (bad) n += 1;
    };
    n;
  };
}
