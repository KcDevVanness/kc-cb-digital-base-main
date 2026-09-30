import { Migration } from '@mikro-orm/migrations';

export class Migration20260930093840_platform_ops extends Migration {

  override name = 'Migration20260930093840';

  override up(): void | Promise<void> {
    this.addSql(`alter table "platform_ops_settlements" add "confirmed_at" timestamptz null, add "paid_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "platform_ops_settlements" drop column "confirmed_at", drop column "paid_at";`);
  }

}
