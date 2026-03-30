#Slice Handoff

At the end of your work, output a COMPLETE markdown handoff report so I can paste it into ChatGPT for the next development step.

Use exactly this structure and headings:

# DEVELOPMENT HANDOFF REPORT

## 1) Objective completed
State exactly what prompt scope was implemented.
State what was intentionally not implemented.

## 2) High-level summary
Give a short but concrete summary of what was built.
Do not use vague phrases like “set up the project” without specifics.

## 3) Files created
List every new file created with its full relative path.

## 4) Files modified
List every existing file modified with its full relative path.

## 5) Repository tree
Show the updated repo tree in a clean code block.

## 6) Dependencies and tooling
List:
- package/dependency manager used
- dependencies added
- dev dependencies added
- Python version targeted
- lint/test/tooling config added

## 7) Environment/config
List every environment variable currently required or supported.
For each one, provide:
- variable name
- required or optional
- default if any
- what it is used for

## 8) Database and migrations
Describe exactly:
- migration strategy used
- schemas created
- tables created
- indexes created
- constraints created
- seed files added
- seed rows inserted conceptually

Then include the FULL contents of any migration files and seed SQL files created in this step.

## 9) CLI / entrypoints
List every command currently available.
For each command, show:
- command name
- what it does
- current status (working, stub, partial)

## 10) Provider abstraction status
Describe exactly what provider-agnostic abstractions now exist.
List the classes, interfaces, config files, or modules that form the abstraction seam.
State whether STM-specific wiring exists yet.

## 11) Commands executed
List every command you ran during implementation, in order, in code blocks.
Examples:
- uv sync
- pytest
- ruff check
- alembic upgrade head
- python -m ...
Do not omit failed commands.

## 12) Validation results
For each command run, state:
- whether it passed or failed
- the important output
- what that means

If something was not run, say it was not run.

## 13) Errors encountered
List every error, failed command, broken import, migration issue, or unresolved problem hit during implementation.
For each one, state:
- exact error
- cause
- fix applied
- whether fully resolved

If there were no errors, explicitly say so.

## 14) Assumptions made
List every assumption made about:
- schema design
- naming
- provider IDs
- URLs
- storage
- local setup
- package versions
- folder structure

## 15) Known gaps / deferred work
List everything intentionally left for the next slice.
Be specific.

## 16) Next recommended prompt
Write the exact next Codex prompt that should be run after this one.
It must match the current state of the repo and build on what was actually implemented.


## 17) Final status
Give one of:
- COMPLETE
- COMPLETE WITH GAPS
- PARTIAL
- BLOCKED

Then explain why.

Rules for this report:
- Be precise and honest.
- Do not claim something works unless you actually ran it.
- Do not hide failed commands.
- Do not summarize migration/code changes vaguely.
- Do not omit files.
- Do not shorten the report just to be concise.
- Use markdown.


Important: optimize the handoff report so another engineer can continue the project without reopening all files manually.



-----------------
# Pipeline adjustment handoff:

At the end of your work, output a COMPLETE markdown handoff report.

Use exactly this structure and headings:

# DEVELOPMENT HANDOFF REPORT

## 1) Objective completed
- State exactly what prompt scope was implemented.
- State what was intentionally not implemented.

## 2) High-level summary
- Short, concrete summary of what changed.
- Focus on retention, hot/warm/cold split, indexing, cadence, orchestration, and validation.

## 3) Files created
- List every new file created with full relative path.

## 4) Files modified
- List every existing file modified with full relative path.

## 5) Database and migrations
Describe exactly:
- migrations added or modified
- tables/views/materialized tables added or changed
- indexes added or changed
- retention logic added
- pruning / cleanup logic added
- any schema decisions relevant to hot/warm/cold storage

If new migration files were created in this step, include their full contents.
If no migration files were created, say so.

## 6) Commands executed
List every command run during implementation, in order, in code blocks.
Do not omit failed commands.

## 7) Validation results
For each command run, state:
- pass/fail
- important output
- what it means

If something was not run, explicitly say it was not run.

## 8) Errors encountered
List every error or failed command.
For each one, state:
- exact error
- cause
- fix applied
- whether fully resolved

If there were no errors, explicitly say so.

## 9) Assumptions made
List assumptions about:
- retention windows
- cadence
- Neon/R2 usage
- Power BI access patterns
- table size expectations
- local/dev environment

## 10) Known gaps / deferred work
List everything intentionally left for the next slice.
Be specific.

## 11) Next recommended Claude Code prompt
Write the exact next prompt that should be run after this one.
It must build on what was actually implemented.

## 12) Final status
Give one of:
- COMPLETE
- COMPLETE WITH GAPS
- PARTIAL
- BLOCKED

Then explain why.

Rules:
- Be precise and honest.
- Do not claim something works unless you actually ran it.
- Do not hide failed commands.
- Do not summarize code/migration changes vaguely.
- Do not omit files you changed.
- Use markdown.