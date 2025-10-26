# Data Migration Scripts

Place data-loading SQL files in this directory. Use numeric prefixes to control execution order (e.g., `001_`, `002_`). Execute them with `psql -f` against the local PostgreSQL instance after the schema is in place.
