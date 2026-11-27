
import {SearchPage} from "../model/SearchPage";
import HandleContext from "../model/HandleContext";
import {DoubanFrodoClient} from "../handler/DoubanFrodoClient";
import {SupportType} from "../../../constant/Constsant";
import {SearchPageFetcher} from "./searcher/SearchPageFetcher";
import {SearchResultPageParser} from "./parser/SearchResultPageParser";

export default class SearcherV2 {
	static search(searchItem: string, searchType: SupportType, pageNum:number, pageSize: number, context: HandleContext): Promise<SearchPage> {
		// 影视和书籍从 Frodo 读取公开结果，搜索分流取决于资源类型。
		if (DoubanFrodoClient.supports(searchType)) {
			const frodo = DoubanFrodoClient.fromSettings(context.plugin.app, context.settings);
			return frodo.search(searchItem, searchType, pageNum, pageSize);
		}
		// 「全部」及其余分类继续用网页请求器和对应的 HTML 或 JSON 解析器。
		return new SearchPageFetcher(context.plugin.settingsManager)
			.fetch(searchItem, searchType, pageNum, pageSize)
			.then(e => new SearchResultPageParser()
				.parse(e, searchType, pageNum, pageSize));
	}

}
