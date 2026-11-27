import { SupportType } from "../../../constant/Constsant";
import {SearchPageTypeOf} from "./SearchPageTypeOf";

export class SearchPage extends SearchPageTypeOf<any> {

	// 标记当前结果来自支持免登录翻页的数据源。省略时沿用网页搜索的登录判断。
	constructor(total: number, pageNum: number, pageSize: number, type: SupportType, list: any[],
		public readonly allowsAnonymousPagination?: boolean) {
		super(total, pageNum, pageSize, type, list);
	}

	public static empty(type: SupportType): SearchPage {
		return new SearchPage(0, 1, 0, type, []);
	}

	static emptyWithNoType() {
		return new SearchPage(0, 1, 0, null, []);
	}
}
