# Security policy

## Supported version

Security fixes are provided for the latest release.

## Reporting a vulnerability

Use GitHub's private security-advisory flow for this repository. Do not open a public issue for a vulnerability that could expose local files, attachment contents, session boundaries, archive parser limits, or command execution.

Include the affected version, operating system, DSH version, reproduction steps, and whether the issue requires a malicious attachment or remote access. Remove private document contents, credentials, and local absolute paths from the report.

## Trust boundary

Attachment bodies are untrusted user data. The plugin never treats document text as system or developer instructions. The model receives only the bounded fragments returned by attachment tools. ZIP and folder entries are validated before persistence, and Office macros or embedded executables are never run.
