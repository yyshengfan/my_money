import { Money } from '../entity/entities/Money';
import { Repository } from 'typeorm';
import { MoneyDTO } from '../dto/money.dto';
export declare class MoneyService {
    money: Repository<Money>;
    createNew(params: MoneyDTO): Promise<import("typeorm").InsertResult>;
    getlastRecord(): Promise<Money>;
}
