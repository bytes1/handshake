Place the Base-64 X.509 root CA certificate used by your HTTPS/SMTP inspection
software in this folder as a `.crt` file. The devcontainer imports these local
certificates into its CA store at build time. Certificate files are ignored by
Git because they are specific to the local machine or network.
