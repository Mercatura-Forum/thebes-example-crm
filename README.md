# thebes-example-crm

An on-chain CRM built on [Thebes Protocol](https://github.com/Mercatura-Forum/Thebes-Protocol-):
a Motoko backend that holds contacts, a forward-only sales pipeline, and an
activity log, and a React frontend served as certified assets. It demonstrates
the full shape of a Thebes application — passkey sign-in, controller-gated
admin, per-caller ownership, paginated reads, and threshold-signed on-chain
state — in one self-contained example.

## Architecture

```
frontend (React + Vite + Tailwind)   →   crm backend (Motoko)
   @thebes/sdk  ── boundary client       mo:thebes-lib ── Admin / Pagination
   Memphis passkey gate                  contacts · deals · activities
```

- **frontend/** uses `@thebes/sdk` for the boundary client, typed query/update
  calls, React hooks, and the Memphis passkey gate. The SDK is **vendored** under
  `frontend/vendor/@thebes/sdk` and resolved as a local dependency.
- **motoko/** uses `thebes-lib` for `Admin` (controller-gated operations, here
  the manager role) and `Pagination`; the CRM logic lives in `main.mo`. The
  library is **vendored** under `motoko/thebes-lib` and resolved as a local Mops
  dependency.

Both halves are self-contained: the repository builds with the vendored SDK and
library, no external Git or Mops pin required. The frontend asset-canister wasm
is the one artifact fetched at deploy time (see [Deploy](#deploy)).

## Backend interface (selected)

| Method | Kind | Purpose |
| --- | --- | --- |
| `myContactsView` / `listMyContacts` | query | The caller's own contacts. |
| `pipelineView` | query | Pipeline rollup (open / won / lost value). |
| `seedDemo` | update | Populate the caller's own demo book. |
| `addContact` / `setContactPhotoOrTrap` | update | Create / photograph a contact (rep-owned). |
| `addDealOrTrap` / `advanceDealOrTrap` | update | Open a deal, advance it forward through the pipeline; traps on any guard failure so the client never silently ignores an error. |
| `logActivityOrTrap` | update | Append a note / call / email / meeting to a contact. |
| `reassignContact` | update | Manager-only: hand a contact to another rep. |
| `claimOwner` / `addAdmin` / `setPaused` | update | Ownership and admin surface (from `thebes-lib`'s `Admin`). |

Two correctness guards make the data trustworthy: the **forward-only pipeline**
(`lead → qualified → proposal → won | lost`, with `won`/`lost` terminal) and
**per-rep ownership** (a rep touches only its own records; the manager is the one
role that reaches the whole book). Deal value is stored in cents.

## Toolchain

- **Motoko compiler 1.4.1.** `mops install` fetches the pinned compiler to
  `~/.cache/mops/moc/1.4.1/moc` (macOS: `~/Library/Caches/mops/moc/1.4.1/moc`).
  Use that binary — the `moc` on a default `PATH` may be a different version, or
  Qt's unrelated Meta-Object Compiler.
- **Node 18+** and **[Mops](https://mops.one)** for the two builds.
- **[`thebes-deploy`](https://github.com/Mercatura-Forum/Thebes-Protocol-/releases)**
  to deploy. The prebuilt binary is Linux x86-64; on other platforms build it from
  the release source bundle (`cargo build --release -p thebes-deploy`).

## Run locally

```sh
# Frontend
cd frontend
npm install            # resolves the vendored @thebes/sdk
npm run dev            # sync-sdk copies the browser runtimes into public/, then Vite serves

# Backend (compile-check)
cd ../motoko
mops install           # resolves the vendored thebes-lib + the pinned compiler
"$(ls "$HOME/.cache/mops/moc/1.4.1/moc" "$HOME/Library/Caches/mops/moc/1.4.1/moc" 2>/dev/null | head -1)" --check $(mops sources) main.mo
```

## Deploy

`thebes.toml` describes the deploy. Its `[networks.wan].validators` are pre-filled
with the current cluster endpoints — run `thebes-deploy init` at any time to print
the live WAN cluster validators and refresh them.

### 1. Backend

```sh
thebes-deploy identity new me      # one-time local signing identity
thebes-deploy deploy crm           # build + install + verify → prints the backend cid
```

### 2. Frontend

The frontend installs an asset canister, then uploads your built bundle. Fetch the
asset-canister wasm once (it is referenced by `thebes.toml` as `asset_canister.wasm`):

```sh
curl -L -o asset_canister.wasm \
  https://github.com/Mercatura-Forum/Thebes-Protocol-/releases/download/asset-canister-v0.1.0/asset_canister.wasm
```

Build the bundle and point it at your backend cid (the frontend reads
`window.CRM_CID` at runtime), then deploy:

```sh
cd frontend && npm run build && cd ..
# inject the backend cid from step 1 into the built page:
sed -i 's#<head>#<head><script>window.CRM_CID=YOUR_CRM_CID;</script>#' frontend/dist/index.html
thebes-deploy deploy web           # install asset canister + upload bundle + verify
```

The deploy prints the live URL:
`https://memphis.mercaturaforum.com/_/raw/<web-cid>/index.html`.

> Contact photos are served by a separate media canister via `window.MEDIA_CID`.
> It is optional — without one, contacts render with generated initial avatars.

For a machine-readable deploy contract, see [AGENTS.md](AGENTS.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
