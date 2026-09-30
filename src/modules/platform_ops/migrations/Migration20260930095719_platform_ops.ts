import { Migration } from '@mikro-orm/migrations';

export class Migration20260930095719_platform_ops extends Migration {

  override name = 'Migration20260930095719';

  override up(): void | Promise<void> {
    this.addSql(`alter table "platform_ops_settlements" drop column "confirmed_at", drop column "paid_at";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "platform_ops_settlements" add "confirmed_at" timestamptz(6) null, add "paid_at" timestamptz(6) null;`);
  }

}
