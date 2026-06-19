# AGENTS.md — deploying this example

A canonical, copy-pasteable contract for an automated agent deploying
`thebes-example-crm` to a Thebes cluster. Human-readable detail is in
[README.md](README.md).

## Layout

```
thebes.toml                 deploy manifest (network + canisters)
motoko/main.mo              backend (Motoko); imports mo:thebes-lib/{Admin,Pagination}
motoko/thebes-lib/          vendored backend library (local Mops dep — no external pin)
frontend/                   React + Vite app on @thebes/sdk
frontend/vendor/@thebes/sdk vendored SDK (local file: dep — no external pin)
```

## Toolchain (exact)

- Motoko compiler **1.4.1**, fetched by `mops install` to
  `~/.cache/mops/moc/1.4.1/moc` (macOS: `~/Library/Caches/mops/moc/1.4.1/moc`).
  Do **not** invoke a bare `moc` — a default `PATH` may resolve a different
  compiler version or Qt's Meta-Object Compiler.
- Node 18+, Mops, and the `thebes-deploy` CLI (Linux x86-64 prebuilt; build from
  the release source bundle on other platforms).
- `mops install` prints `core@2.5.0 requires moc >= 1.6.0` while 1.4.1 is pinned.
  This is expected — the cluster pins 1.4.1 and the build succeeds.

## Deploy

```sh
# 0. network: the validators in thebes.toml [networks.wan] are pre-filled.
#    Refresh them to the current cluster endpoints with:
thebes-deploy init            # prints current WAN cluster validators

# 1. backend
thebes-deploy identity new me
thebes-deploy deploy crm      # → prints the backend cid (call it CRM_CID)

# 2. frontend
curl -L -o asset_canister.wasm \
  https://github.com/Mercatura-Forum/Thebes-Protocol-/releases/download/asset-canister-v0.1.0/asset_canister.wasm
cd frontend && npm install && npm run build && cd ..
sed -i 's#<head>#<head><script>window.CRM_CID=CRM_CID;</script>#' frontend/dist/index.html
thebes-deploy deploy web      # → prints https://memphis.mercaturaforum.com/_/raw/<cid>/index.html
```

Verify: `curl -s -o /dev/null -w '%{http_code}' <printed-url>` returns `200`.

## Calling the backend

```sh
thebes-deploy query crm pipelineView --arg '(false)'          # queries need no identity
thebes-deploy call  crm seedDemo                              # updates need a local identity
thebes-deploy call  crm addContact \
  --arg '("Ada Lovelace", "Analytical Engines", "ada@example.com", "+1-555-0100", null)'
thebes-deploy call  crm advanceDealOrTrap --arg '(0 : nat, "qualified")'
```

Candid arguments are passed with `--arg` in **textual tuple form** — e.g.
`--arg '("Ada", 42 : nat)'`. A bare positional argument list is **rejected**;
always wrap the call's arguments in a single parenthesised tuple. `null` and
`opt "…"` encode a `?Text` (the optional `photoPath`).

## Backend interface (selected)

| Method | Kind | Arg shape | Purpose |
| --- | --- | --- | --- |
| `seedDemo` | update | `()` | Seed the caller's own demo book (contacts + deals). |
| `addContact` | update | `(text, text, text, text, opt text)` | Create a contact owned by the caller (the rep). |
| `setContactPhotoOrTrap` | update | `(nat, text)` | Set a contact's media-contract photo path; traps on a failed guard. |
| `addDealOrTrap` | update | `(nat, text, nat)` | Open a deal on a contact (value in cents); traps on a failed guard. |
| `advanceDealOrTrap` | update | `(nat, text)` | Advance a deal one stage forward (`lead → qualified → proposal → won \| lost`); traps backward/skip. |
| `logActivityOrTrap` | update | `(nat, text, text)` | Append an activity (`note`/`call`/`email`/`meeting`) to a contact. |
| `reassignContact` | update | `(nat, principal)` | Manager-only: reassign a contact to another rep. |
| `myContactsView` / `listMyContacts` | query | `()` / `(nat, nat)` | The caller's own contacts. |
| `listAllContacts` | query | `(nat, nat)` | Manager-only: the whole book, paginated. |
| `myDealsView` / `dealsView` | query | `()` / `(nat)` | The caller's deals / one contact's deals. |
| `activitiesView` | query | `(nat)` | A contact's activity log. |
| `pipelineView` | query | `(bool)` | Pipeline rollup (`true` = whole book, manager-only). |
| `claimOwner` / `addAdmin` / `setPaused` | update | `()` / `(principal)` / `(bool)` | Ownership and admin surface (from `thebes-lib`'s `Admin`). |

Deal value is stored in **cents**; the frontend groups it as a 2-decimal string.

## Conventions that affect correctness

- **`window.CRM_CID`** (and optional `window.MEDIA_CID`) are injected into the
  built page at deploy time; the frontend reads them at runtime. If you skip the
  injection step, the page falls back to compiled-in defaults (`0`) and cannot
  reach a backend.
- **`*OrTrap` methods** (e.g. `advanceDealOrTrap`, `addDealOrTrap`,
  `logActivityOrTrap`, `setContactPhotoOrTrap`) trap on a failed guard so the
  client sees a rejection instead of a silently-swallowed error. Frontends call
  the `OrTrap` form for any guarded write.
- **Per-rep ownership.** Every non-anonymous caller is a sales rep that owns the
  contacts and deals it creates. A rep reads/mutates only its own records; the
  manager (owner + granted admins) is the sole role that sees the whole book and
  can reassign a contact.
- **Boundary decoding** returns a `vec record` of scalar fields. A single record
  is a 0-or-1-element array; principal fields are 56-character hex. Decode with
  the SDK's `decodeVecRecord` / `decodeNat`.
- **Contact photos** are stored in a separate media contract via
  `window.MEDIA_CID`. The path the backend holds (`photoPath`) points there; the
  bytes never live in the CRM canister (the storage law). Photos are optional —
  without a media contract, contacts render with generated initial avatars.
