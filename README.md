# ZUZU - setup (about 15 minutes)

1. **Supabase**: create a project -> SQL Editor -> paste `schema.sql` -> Run.
2. **Login**: Authentication -> Providers -> enable Email. For Google: create an OAuth client in Google Cloud, paste its Client ID/Secret into the Google provider, and add the Supabase callback URL it shows to Google's "Authorized redirect URIs".
3. **URLs**: Authentication -> URL Configuration -> set Site URL to your GitHub Pages address and add the same address under Redirect URLs.
4. **Keys**: Project Settings -> API -> copy the Project URL and the publishable (anon) key into `config.js`. Never use the service_role key.
5. **GitHub Pages**: new public repo -> upload all files in this folder -> Settings -> Pages -> Deploy from branch `main` / root.
6. **Before launch**: open `privacy.html` and `terms.html`, replace `[Your Name]` and `[Your Country]`, and have a lawyer review them (they are starter templates).
7. **Support inbox**: messages sent from the site appear in Supabase -> Table Editor -> `support_messages` (change `status` to track complaints).
8. **Admin inbox**: create your own account on the site, then in SQL Editor run the commented `insert into public.admins ...` line from `schema.sql` with your email. Open `your-site/admin.html` while signed in on the main site. Only admins can read messages; the page is not linked anywhere.
