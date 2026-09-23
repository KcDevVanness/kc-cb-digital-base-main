import { Migration } from '@mikro-orm/migrations';

export class Migration20260922070547_sourcing extends Migration {

  override name = 'Migration20260922070547';

  override up(): void | Promise<void> {
    this.addSql(`create table "sourcing_import_profiles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "name" text not null, "supplier_id" uuid null, "layout_signature" text not null, "sheet_name" text null, "header_row_index" int not null, "column_map" jsonb not null, "section_rules" jsonb null, "field_options" jsonb null, "built_in" boolean not null default false, "usage_count" int not null default 0, "last_used_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "sourcing_import_profiles_scope_idx" on "sourcing_import_profiles" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sourcing_import_profiles" add constraint "sourcing_import_profiles_scope_signature_uniq" unique ("tenant_id", "organization_id", "layout_signature");`);

    this.addSql(`create table "sourcing_quotes" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "number" text null, "supplier_id" uuid null, "supplier_name_snapshot" text null, "quote_date" date null, "valid_until" date null, "currency_code" text not null default 'CNY', "status" text not null default 'draft', "source_kind" text not null default 'excel_import', "source_attachment_id" uuid null, "source_file_name" text null, "source_sheet_name" text null, "source_layout_signature" text null, "header_row_index" int null, "column_map" jsonb null, "section_rules" jsonb null, "source_profile_id" uuid null, "line_count" int not null default 0, "promoted_count" int not null default 0, "notes" text null, "approved_at" timestamptz null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "sourcing_quotes_signature_idx" on "sourcing_quotes" ("source_layout_signature");`);
    this.addSql(`create index "sourcing_quotes_scope_idx" on "sourcing_quotes" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sourcing_quotes" add constraint "sourcing_quotes_scope_number_uniq" unique ("tenant_id", "organization_id", "number");`);

    this.addSql(`create table "sourcing_quote_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "quote_id" uuid not null, "line_number" int not null, "source_row_number" int null, "section_label" text null, "item_no" text null, "product_name" text null, "variant_label" text null, "derived_sku" text null, "hs_code" text null, "description" text null, "unit" text not null default 'PCS', "unit_cost" numeric(18,6) null, "currency_code" text null, "suggested_rsp" numeric(18,6) null, "moq_raw" text null, "moq_quantity" int null, "carton_quantity" int null, "cartons" int null, "unit_net_weight" numeric(16,4) null, "carton_gross_weight" numeric(16,4) null, "carton_net_weight" numeric(16,4) null, "inner_packing" jsonb null, "outer_packing" jsonb null, "carton_volume" numeric(16,6) null, "raw" jsonb null, "warnings" jsonb not null default '[]', "row_status" text not null default 'staged', "selected" boolean not null default true, "promoted_product_id" uuid null, "promoted_price_id" uuid null, "promoted_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "sourcing_quote_lines_sku_idx" on "sourcing_quote_lines" ("derived_sku");`);
    this.addSql(`create index "sourcing_quote_lines_scope_idx" on "sourcing_quote_lines" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sourcing_quote_lines" add constraint "sourcing_quote_lines_quote_line_uniq" unique ("quote_id", "line_number");`);

    this.addSql(`alter table "sourcing_quote_lines" add constraint "sourcing_quote_lines_quote_id_foreign" foreign key ("quote_id") references "sourcing_quotes" ("id") on delete cascade;`);
  }

}
