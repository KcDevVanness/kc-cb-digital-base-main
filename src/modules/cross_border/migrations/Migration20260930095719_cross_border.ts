import { Migration } from '@mikro-orm/migrations';

export class Migration20260930095719_cross_border extends Migration {

  override name = 'Migration20260930095719';

  override up(): void | Promise<void> {
    this.addSql(`alter table "cross_border_export_documents" drop column "status";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "cross_border_export_documents" add "status" text null;`);
  }

}
