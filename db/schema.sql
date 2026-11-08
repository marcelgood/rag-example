-- Larkspur Labs (fictional) sales database.
-- This file is used twice: the seed script runs it to create the tables, and
-- the text-to-SQL step sends it to Claude as the schema description. The
-- comments are what tell the model what each column means, so keep them
-- accurate.

CREATE TABLE customers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,      -- vineyard or company name
  country     TEXT NOT NULL,      -- country name in English, e.g. 'Portugal'
  region      TEXT NOT NULL,      -- wine region, e.g. 'Douro', 'Rioja'
  signed_up   TEXT NOT NULL       -- date the customer signed up, 'YYYY-MM-DD'
);

CREATE TABLE products (
  id              INTEGER PRIMARY KEY,
  sku             TEXT NOT NULL UNIQUE,  -- e.g. 'RL-SENSOR'
  name            TEXT NOT NULL,
  unit_price_eur  REAL NOT NULL          -- current list price in euros, excluding VAT
);

CREATE TABLE orders (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  order_date   TEXT NOT NULL,   -- 'YYYY-MM-DD'
  status       TEXT NOT NULL    -- 'paid', 'pending' (invoice sent, not yet due),
                                -- 'overdue' (invoice past due, unpaid) or 'refunded'
);

CREATE TABLE order_items (
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL,
  unit_price_eur  REAL NOT NULL,  -- price actually charged per unit (may include a discount)
  PRIMARY KEY (order_id, product_id)
);
-- An order's total is SUM(quantity * unit_price_eur) over its order_items.
-- Revenue usually means paid orders only.
