-- Local development only: lets the Storage API container connect (Supabase's hosted platform manages this itself).
\set pw `echo "$POSTGRES_PASSWORD"`
ALTER ROLE supabase_storage_admin WITH LOGIN PASSWORD :'pw';
