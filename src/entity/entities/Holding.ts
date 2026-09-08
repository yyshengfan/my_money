import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

// 股票持仓清单(v1 手工维护,改清单直接改表);表结构见 data/mysql.sql
@Entity("holding", { schema: "tianhuiaccount" })
export class Holding {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("varchar", {
    name: "code",
    unique: true,
    comment: "600036 / 02331",
    length: 10,
  })
  code: string;

  @Column("varchar", { name: "name", comment: "名称", length: 64 })
  name: string;

  @Column("varchar", {
    name: "market",
    comment: "A股·沪 / A股·深 / 港股",
    length: 16,
  })
  market: string;

  @Column("datetime", {
    name: "created_at",
    nullable: true,
    default: () => "CURRENT_TIMESTAMP",
  })
  createdAt: Date | null;
}
