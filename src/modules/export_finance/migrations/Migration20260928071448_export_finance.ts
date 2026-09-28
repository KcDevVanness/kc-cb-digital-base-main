import { Migration } from '@mikro-orm/migrations';

export class Migration20260928071448_export_finance extends Migration {

  override name = 'Migration20260928071448';

  override up(): void | Promise<void> {
    this.addSql(`alter table "export_finance_collections" add "amount" numeric(18,4) null, add "received_at" date null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "export_finance_collections" drop column "amount", drop column "received_at";`);
  }

}
