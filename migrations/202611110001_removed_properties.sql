CREATE TABLE removed_properties (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 site_url text NOT NULL,
 PRIMARY KEY(user_id, site_url)
);
