import { Migration } from '@mikro-orm/migrations';

export class Migration20260921100702_purchasing extends Migration {

  override name = 'Migration20260921100702';

  override up(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_payments" add "attachment_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_payments" drop column "attachment_id";`);
  }

}
