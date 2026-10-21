# Privacy

DSH Knowledge Base is a local-only plugin.

- **No network calls.** The Host half scans local files and serves local HTTP routes on the DSH web server; it does not send data to a remote service.
- **No telemetry.** There is no analytics, crash reporting, or usage reporting.
- **No API keys.** The plugin does not call an LLM or any third-party API. Auto-classification uses local path/title/keyword rules.
- **Local storage.** Entries, categories, and notes are stored in `<workspace>/.knowledge-base/entries.json`. Project files stay where they are.
- **Read scope.** The plugin scans the configured workspace root and serves previews only for files inside that root. Path traversal outside the root is rejected.
- **Browser-visible data.** File previews and image previews are served over the local DSH web server to the page; they are not uploaded anywhere.

If you publish a modified version, keep these properties explicit in your own README, or disclose any network/telemetry additions.
