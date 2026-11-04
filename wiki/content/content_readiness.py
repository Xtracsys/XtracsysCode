"""User guidance for running and maintaining XtracsysCode."""
ARTICLES = [dict(
    slug="usage-and-safety", title="Using XtracsysCode", category="docs",
    path="USER_GUIDE.md", lang="Markdown", status="GUIDE", pkg="docs", phase="0.5.0",
    related=["doc-readme", "agent-tools", "skills", "plugins", "host-storage"],
    lead=["XtracsysCode connects project conversations to local models and visible tools. Choose a project folder, configure a loopback model server, and keep approvals set to Ask while learning the tool workflow."],
    sections=[
        ("Start a project", ["Install the release for your operating system or build from source. Start Ollama, llama.cpp, GMLX, or MLX LM server on localhost. In Settings → Backends, select the provider, URL and model, then create a project using its existing folder."]),
        ("Review actions", ["Review file writes, shell commands and MCP tools before approving them. Shell commands, plugins and MCP servers run with your OS user permissions. They are not confined by the file tools' project-path checks and may use the network. Auto mode reduces approval prompts; use it only for tasks and sources you trust."]),
        ("Add skills and plugins", ["Skills supply instructions and reference files. Plugins run a local tool process. Inspect imported source and requested commands before enabling a plugin. Imported plugins start disabled; changed plugin source requires a new review."]),
        ("Keep your data", ["Chats, settings, logs, skills and plugins live under the user-visible data root, normally ~/XtracsysCode. Configure storage limits in Settings. Export a backup before changing machines or restoring data. A restore resets approval rules, pauses schedules and disables imported plugins for review."]),
        ("Get help", ["Use the platform installation guides and USER_GUIDE.md for detailed steps. Report reproducible problems with the app version, platform and synthetic reproduction. Send security reports to opensource@xtracsys.com. Remove personal paths, tokens and chat content from shared logs."]),
    ],
)]
