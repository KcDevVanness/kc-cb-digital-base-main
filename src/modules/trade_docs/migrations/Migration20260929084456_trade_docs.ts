import { Migration } from '@mikro-orm/migrations';

export class Migration20260929084456_trade_docs extends Migration {

  override name = 'Migration20260929084456';

  override up(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_contracts" drop column "marks";`);

    this.addSql(`alter table "trade_docs_documents" drop column "marks";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_contracts" add "marks" text null;`);

    this.addSql(`alter table "trade_docs_documents" add "marks" text null;`);
  }

}
