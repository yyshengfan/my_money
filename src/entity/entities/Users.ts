import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

// 登录账号表(单账号 v1);表结构见 data/mysql.sql,synchronize:false 需手动建表
@Entity("app_users", { schema: "tianhuiaccount" }) // 库里另有一张历史演示 users 表,勿混淆
export class Users {
  @PrimaryGeneratedColumn({ type: "int", name: "id" })
  id: number;

  @Column("varchar", {
    name: "username",
    unique: true,
    comment: "用户名",
    length: 64,
  })
  username: string;

  @Column("varchar", {
    name: "pass_hash",
    comment: "scrypt salt:hex",
    length: 255,
  })
  passHash: string;

  @Column("datetime", {
    name: "created_at",
    nullable: true,
    default: () => "CURRENT_TIMESTAMP",
  })
  createdAt: Date | null;
}
