import { Money } from '../entity/entities/Money';
import { Repository } from 'typeorm';
export declare class UserService {
    money: Repository<Money>;
    getUser(): Promise<Money[]>;
    createNew(): Promise<Money>;
}
