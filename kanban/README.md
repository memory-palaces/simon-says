# Roadmap board

Tasks live as one Markdown file each under `tasks/`, with YAML frontmatter — readable
on GitHub, diffable in review, and editable by hand or by an agent. Managed with
[kanban-md](https://github.com/antopolskiy/kanban-md).

The board itself is committed; the `kanban-md` binary is not (13 MB). To get it:

```bash
# download a release for your platform from the project above, then:
mkdir -p bin && mv ~/Downloads/kanban-md bin/ && chmod +x bin/kanban-md
```

Then:

```bash
bin/kanban-md tui          # interactive board
bin/kanban-md list         # everything, one line each
bin/kanban-md board        # column / priority summary
bin/kanban-md create "..." --tags mobile --priority high
bin/kanban-md move 4 todo
```

Columns: `backlog → todo → in-progress → review → done` (plus `archived`).
Tags in use: `mobile`, `sync`, `format`, `generation`, `worlds`, `export`, `infra`,
`security`, `research`, `ux`.

Editing the `.md` files directly is fine — the CLI just reads them back.
