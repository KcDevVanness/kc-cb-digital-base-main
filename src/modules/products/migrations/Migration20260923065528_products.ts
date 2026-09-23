import { Migration } from '@mikro-orm/migrations';

export class Migration20260923065528_products extends Migration {

  override name = 'Migration20260923065528';

  override up(): void | Promise<void> {
    this.addSql(`alter table "products_products" drop column "carton_dimensions", drop column "carton_gross_weight", drop column "carton_net_weight";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "products_products" add "carton_dimensions" jsonb null, add "carton_gross_weight" numeric(16,4) null, add "carton_net_weight" numeric(16,4) null;`);
  }

}
