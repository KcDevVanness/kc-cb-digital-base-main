import { Migration } from '@mikro-orm/migrations';

export class Migration20260923075340_sourcing extends Migration {

  override name = 'Migration20260923075340';

  override up(): void | Promise<void> {
    this.addSql(`alter table "sourcing_quote_lines" drop column "carton_gross_weight", drop column "carton_net_weight", drop column "carton_volume", drop column "cartons", drop column "outer_packing";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sourcing_quote_lines" add "carton_gross_weight" numeric(16,4) null, add "carton_net_weight" numeric(16,4) null, add "carton_volume" numeric(16,6) null, add "cartons" int null, add "outer_packing" jsonb null;`);
  }

}
