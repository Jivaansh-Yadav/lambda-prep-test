<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Portal architecture
- Shared Lambda navigation and footer live in the root layout so every page maintains the same institutional shell.
- Class hubs use a validated dynamic class route and centralized subject/stream definitions so grade navigation and filters stay consistent.
- Resource availability is shown as an honest empty collection until reviewed materials are supplied; do not fabricate downloadable papers or verified content.
- Account access remains an explicit unavailable state until real authentication is requested and connected; never simulate a successful sign-in.
- Keep page-specific social metadata in each content route using the shared metadata helper.
