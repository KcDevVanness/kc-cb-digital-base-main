import { Migration } from '@mikro-orm/migrations';

export class Migration20260922082559_trade_docs extends Migration {

  override name = 'Migration20260922082559';

  override up(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_contracts" add "attachment_id" uuid null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_contracts" drop column "attachment_id";`);
  }

}
