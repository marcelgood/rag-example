-- Part 6: the multi-tenant sales database (db/tenants.db).
--
-- Every company (tenant) shares the same tables. Each row belongs to exactly
-- one tenant through its tenant_id column, and every query the MCP server
-- runs filters on the tenant of the signed-in user. This "shared schema"
-- design is the most common one; the alternatives are a schema or a whole
-- database per tenant (see the README).
--
-- The user accounts live in the same database, in the tables better-auth
-- creates (user, account, session, jwks). The seed script creates those.

CREATE TABLE tenants (
  id            TEXT PRIMARY KEY,      -- e.g. 'larkspur'
  name          TEXT NOT NULL,         -- company name
  email_domain  TEXT NOT NULL UNIQUE   -- users with this email domain belong to this tenant
);

CREATE TABLE customers (
  id          INTEGER PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  country     TEXT NOT NULL,      -- country name in English, e.g. 'Portugal'
  region      TEXT NOT NULL,      -- region or city
  signed_up   TEXT NOT NULL       -- 'YYYY-MM-DD'
);

CREATE TABLE products (
  id              INTEGER PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  unit_price_eur  REAL NOT NULL,
  UNIQUE (tenant_id, sku)
);

CREATE TABLE orders (
  id           INTEGER PRIMARY KEY,   -- numbered across all tenants
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  order_date   TEXT NOT NULL,         -- 'YYYY-MM-DD'
  status       TEXT NOT NULL          -- 'paid', 'pending', 'overdue' or 'refunded'
);

CREATE TABLE order_items (
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL,
  unit_price_eur  REAL NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

-- Every query starts from a tenant, so index tenant_id.
CREATE INDEX customers_tenant ON customers (tenant_id);
CREATE INDEX products_tenant ON products (tenant_id);
CREATE INDEX orders_tenant ON orders (tenant_id);
