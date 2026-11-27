import type DoubanSubject from "../model/DoubanSubject";
import type HandleContext from "../model/HandleContext";

// 网页和 Frodo 各自将响应转换成条目，导入入口拿到条目后统一保存。
export interface DoubanSubjectLoader<T extends DoubanSubject = DoubanSubject> {
	load(id: string, context: HandleContext): Promise<T>;
}
