import dotenv from 'dotenv';

const envFile = process.env.MCC_ENV_FILE;

// A supplied MCC_ENV_FILE is authoritative for CT103. Local development keeps
// dotenv's normal working-directory .env behavior. quiet prevents dotenv from
// writing any environment-derived output to process logs.
if (envFile) {
  dotenv.config({ path: envFile, override: true, quiet: true });
} else {
  dotenv.config({ quiet: true });
}
