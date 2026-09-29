import { Migration } from '@mikro-orm/migrations';

export class Migration20260929073531_trade_docs extends Migration {

  override name = 'Migration20260929073531';

  override up(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_contract_lines" add "source_snapshot" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "trade_docs_contract_lines" drop column "source_snapshot";`);
  }

}
