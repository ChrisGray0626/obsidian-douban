jest.mock("obsidian", () => ({
	FuzzySuggestModal: class {
		setPlaceholder() {}
		open() {}
	},
	getLanguage: () => "en",
	moment: (value: string) => ({format: () => "2023-01-01", toDate: () => new Date(value)}),
	Notice: jest.fn(),
	Platform: {isDesktopApp: true},
	requestUrl: jest.fn(),
}), {virtual: true});

import {webcrypto} from "crypto";
import {requestUrl} from "obsidian";
import {NavigateType, SearchHandleMode, SupportType} from "../src/org/wanxp/constant/Constsant";
import {DEFAULT_SETTINGS} from "../src/org/wanxp/constant/DefaultSettings";
import {DoubanSubjectState} from "../src/org/wanxp/constant/DoubanUserState";
import {DoubanHttpUtil} from "../src/org/wanxp/utils/DoubanHttpUtil";
import {DoubanSearchChooseItemHandler} from "../src/org/wanxp/douban/data/handler/DoubanSearchChooseItemHandler";
import DoubanAbstractLoadHandler from "../src/org/wanxp/douban/data/handler/DoubanAbstractLoadHandler";
import DoubanMovieLoadHandler from "../src/org/wanxp/douban/data/handler/DoubanMovieLoadHandler";
import HandleContext from "../src/org/wanxp/douban/data/model/HandleContext";
import {DoubanFuzzySuggester} from "../src/org/wanxp/douban/data/search/DoubanSearchFuzzySuggestModal";
import SearcherV2 from "../src/org/wanxp/douban/data/search/SearchV2";
import {SearchPageFetcher} from "../src/org/wanxp/douban/data/search/searcher/SearchPageFetcher";

const request = requestUrl as jest.Mock;
const tv = {
	id: "35465232",
	title: "三体",
	type: "tv",
	intro: "剧集简介",
	original_title: "Three-Body",
	episodes_count: 30,
	rating: {value: 8.7, count: 123},
	directors: [{name: "杨磊", latin_name: "Lei Yang"}],
	pic: {large: "https://img1.doubanio.com/view/photo/l/public/p123.jpg"},
};

function createContext(loggedIn = false): HandleContext {
	const settings = {
		...DEFAULT_SETTINGS,
		cacheImage: false,
		frodoApiKeySecretId: "",
		frodoSigningSecretId: "",
	};
	const userComponent = {isLogin: () => loggedIn};
	const app = {secretStorage: {getSecret: (id: string) => id}};
	const settingsManager = {
		debug: jest.fn(),
		getSelector: (): string[] => [],
		getSetting: (key: keyof typeof settings) => settings[key],
		getHeaders: () => loggedIn ? {Cookie: "test-session"} : {},
	};
	const plugin = {app, settings, settingsManager, userComponent, putToObsidian: jest.fn()};
	return {plugin, settings, userComponent, mode: SearchHandleMode.FOR_CREATE} as unknown as HandleContext;
}

beforeAll(() => {
	if (!globalThis.crypto?.subtle) {
		Object.defineProperty(globalThis, "crypto", {value: webcrypto, configurable: true});
	}
	// Obsidian adds String.contains in its host runtime.
	Object.defineProperty(String.prototype, "contains", {value: String.prototype.includes, configurable: true});
});

afterEach(() => {
	request.mockReset();
	jest.restoreAllMocks();
});

afterAll(() => {
	Reflect.deleteProperty(String.prototype, "contains");
});

it("paginates without a login and renders the selected TV subject using the existing handler", async () => {
	const context = createContext();
	const web = jest.spyOn(DoubanHttpUtil, "httpRequestGet");
	// The built-in credentials work on a fresh setup without Obsidian secret storage.
	delete (context.plugin.app as any).secretStorage;
	const pageSize = 20;
	// 模拟第一页、第二页和所选电视剧详情。总数大于单页容量时应出现下一页。
	request.mockResolvedValueOnce({status: 200, json: {
		total: 21,
		items: [{type_name: "电影", target: {id: "1292052", title: "肖申克的救赎", type: "movie"}}],
	}}).mockResolvedValueOnce({status: 200, json: {
		total: 21,
		items: [{type_name: "电视剧", target: tv}],
	}}).mockResolvedValueOnce({status: 200, json: tv});
	const firstPage = await SearcherV2.search("豆瓣", SupportType.movie, 1, pageSize, context);
	context.searchPage = firstPage;
	const modal = new DoubanFuzzySuggester(context.plugin, context, "豆瓣");
	modal.showSearchPage(firstPage);

	const next = modal.getItems().find(item => item.url === NavigateType.next);
	expect(next).toBeDefined();
	await expect(modal.handleNavigate(next)).resolves.toBe(true);
	const selected = modal.getItems().find(item => item.id === tv.id);
	expect(selected).toMatchObject({type: SupportType.teleplay, title: tv.title, score: 8.7});

	const handler = new DoubanSearchChooseItemHandler(context.plugin.app, context.plugin);
	jest.spyOn(DoubanAbstractLoadHandler.prototype as any, "getTemplate")
		.mockResolvedValue("---\nid: {{id}}\ntitle: {{title}}\ntype: {{type}}\nepisode: {{episode}}\n---\n{{desc}}");
	const subject = await handler.handle(selected, context);
	expect(subject).toMatchObject({id: tv.id, type: SupportType.teleplay, originalTitle: "Three-Body"});
	expect(context.plugin.putToObsidian).toHaveBeenCalledTimes(1);
	expect(context.plugin.putToObsidian).toHaveBeenCalledWith(context, subject);
	if (!subject) {
		throw new Error("Expected a TV subject");
	}
	const note = await handler.parseText(subject, context);
	expect(note.content).toContain("title: 三体");
	expect(note.content).toContain("episode: 30");
	expect(note.content).toContain("剧集简介");

	const urls = request.mock.calls.map(([options]) => new URL(options.url));
	expect(urls.map(url => url.pathname)).toEqual([
		"/api/v2/search/weixin", "/api/v2/search/weixin", "/api/v2/tv/35465232",
	]);
	expect(urls.slice(0, 2).map(url => url.searchParams.get("start"))).toEqual(["0", "20"]);
	// 公开接口需要应用请求参数和签名，这组断言也检查没有携带账号 Cookie。
	for (const [index, url] of urls.entries()) {
		expect(url.searchParams.get("apiKey")).toBeTruthy();
		expect(url.searchParams.get("os_rom")).toBe("android");
		expect(url.searchParams.get("_sig")).toBeTruthy();
		expect(request.mock.calls[index][0].headers["User-Agent"]).toBeTruthy();
	}
	expect(web).not.toHaveBeenCalled();
	expect(request.mock.calls.every(([options]) => !("Cookie" in options.headers))).toBe(true);
});

it("searches for and imports music through the website", async () => {
	const context = createContext();
	const id = "1234567";
	const url = "https://music.douban.com/subject/1234567/";
	jest.spyOn(SearchPageFetcher.prototype, "fetch").mockResolvedValue(JSON.stringify({total: 1, limit: 20, items: [
		'<div class="result"><div class="content"><div><h3><span>音乐</span><a href="' +
		encodeURIComponent(url) + '">搜索标题</a></h3></div></div></div>',
	]}));
	const web = jest.spyOn(DoubanHttpUtil, "httpRequestGet").mockResolvedValue(
		'<meta property="og:title" content="专辑标题"><meta property="og:url" content="' + url + '">',
	);
	const page = await SearcherV2.search("专辑", SupportType.music, 1, 20, context);
	const handler = new DoubanSearchChooseItemHandler(context.plugin.app, context.plugin);
	const subject = await handler.handle(page.list[0], context);

	expect(page.allowsAnonymousPagination).toBeUndefined();
	expect(subject).toMatchObject({id, title: "专辑标题", type: SupportType.music});
	expect(web).toHaveBeenCalledTimes(1);
	expect(request).not.toHaveBeenCalled();
	expect(context.plugin.putToObsidian).toHaveBeenCalledWith(context, subject);
});

it("keeps webpage type detection when synchronizing a movie collection", async () => {
	const context = createContext(true);
	context.syncActive = true;
	const url = "https://movie.douban.com/subject/35465232/";
	const web = jest.spyOn(DoubanHttpUtil, "httpRequestGet").mockResolvedValue(
		'<meta property="og:title" content="三体"><meta property="og:url" content="' + url + '">' +
		'<div class="nav-user-account"></div><p>我看过这部电视剧</p>',
	);
	const handler = new DoubanMovieLoadHandler(context.plugin);

	const subject = await handler.handle(tv.id, context);

	expect(subject).toMatchObject({id: tv.id, type: SupportType.movie, guessType: SupportType.teleplay});
	expect(web).toHaveBeenCalledWith(url, {Cookie: "test-session"}, context.plugin.settingsManager);
	expect(request).not.toHaveBeenCalled();
	expect(context.plugin.putToObsidian).toHaveBeenCalledWith(context, subject);
});

it("overrides the built-in credentials only when a full custom pair is available", async () => {
	const context = createContext();
	request.mockResolvedValue({status: 200, json: {items: [], total: 0}});
	// 先只配置 API Key，再补齐签名密钥，分别验证默认和自定义请求。
	context.settings.frodoApiKeySecretId = "test-key";
	await SearcherV2.search("豆瓣", SupportType.movie, 1, 20, context);

	context.settings.frodoSigningSecretId = "test-secret";
	await SearcherV2.search("豆瓣", SupportType.movie, 1, 20, context);

	const [defaultKey, customKey] = request.mock.calls.map(([options]) =>
		new URL(options.url).searchParams.get("apiKey"));
	expect(defaultKey).toBeTruthy();
	expect(defaultKey).not.toBe("test-key");
	expect(customKey).toBe("test-key");
});

it("does not write a note when the application request fails", async () => {
	const context = createContext();
	jest.spyOn(console, "log").mockImplementation(() => undefined);
	jest.spyOn(console, "error").mockImplementation(() => undefined);
	request.mockResolvedValue({status: 403, json: {}});
	const handler = new DoubanSearchChooseItemHandler(context.plugin.app, context.plugin);
	const result = await handler.handle({...tv, type: SupportType.teleplay} as any, context);
	expect(result).toBeUndefined();
	expect(context.plugin.putToObsidian).not.toHaveBeenCalled();
});

it("imports a TV link as TV and adds the signed-in personal record from the website", async () => {
	const context = createContext(true);
	const url = "https://movie.douban.com/subject/35465232/";
	// 影视链接不带类型，电影接口找不到时由电视剧详情确认资源类型。
	request.mockResolvedValueOnce({status: 404}).mockResolvedValueOnce({status: 200, json: tv});
	const web = jest.spyOn(DoubanHttpUtil, "httpRequestGet").mockResolvedValue(
		'<div class="nav-user-account"></div><meta property="og:title" content="网页标题">' +
		'<div id="interest_sect_level"><div class="a_stars">' +
		'<span class="mr10">想看 <span class="collection_date">2023-01-01</span></span>' +
		'<input id="n_rating" value="4"><span class="color_gray">标签: 科幻 剧集</span>' +
		'<span class="user-comment">个人短评</span></div></div>',
	);
	const handler = new DoubanSearchChooseItemHandler(context.plugin.app, context.plugin);
	const subject = await handler.handle({id: tv.id, url, type: SupportType.movie} as any, context);

	expect(request.mock.calls.map(([options]) => new URL(options.url).pathname)).toEqual([
		"/api/v2/movie/35465232", "/api/v2/tv/35465232",
	]);
	expect(subject).toMatchObject({
		id: tv.id, type: SupportType.teleplay, title: tv.title, score: 8.7,
		userState: {
			state: DoubanSubjectState.wish, rate: 4, collectionDate: new Date("2023-01-01"),
			tags: ["科幻", "剧集"], comment: "个人短评",
		},
	});
	expect(web).toHaveBeenCalledWith(url, {Cookie: "test-session"}, context.plugin.settingsManager);
	expect(context.plugin.putToObsidian).toHaveBeenCalledWith(context, subject);
});

it("uses Frodo for public search even when signed in to Douban", async () => {
	const context = createContext(true);
	const fetch = jest.spyOn(SearchPageFetcher.prototype, "fetch");
	request.mockResolvedValue({status: 200, json: {items: [{type_name: "电视剧", target: tv}], total: 1}});
	const page = await SearcherV2.search("三体", SupportType.movie, 1, 20, context);

	expect(fetch).not.toHaveBeenCalled();
	expect(page.list[0]).toMatchObject({id: tv.id, title: tv.title});
	expect(page.allowsAnonymousPagination).toBe(true);
	expect(request.mock.calls[0][0].headers).not.toHaveProperty("Cookie");
});

it("saves the public detail when reading personal activity fails", async () => {
	const context = createContext(true);
	request.mockResolvedValue({status: 200, json: tv});
	jest.spyOn(DoubanHttpUtil, "httpRequestGet").mockRejectedValue(new Error("Session expired"));
	const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
	const handler = new DoubanSearchChooseItemHandler(context.plugin.app, context.plugin);
	const result = await handler.handle({...tv, type: SupportType.teleplay} as any, context);

	expect(result).toMatchObject({id: tv.id, title: tv.title, userState: null});
	expect(context.plugin.putToObsidian).toHaveBeenCalledWith(context, result);
	expect(warn).toHaveBeenCalledTimes(1);
});

const book = {
	id: "35658388",
	title: "黑暗帝国 2",
	type: "book",
	intro: "图书简介",
	author: ["[英] 盖伊·哈雷"],
	translator: ["韩之昱"],
	press: ["浙江科学技术出版社"],
	pubdate: ["2021-11"],
	pages: ["288"],
	price: ["55元"],
	book_subtitle: "纳垢战争",
	book_series: {title: "战锤40000"},
	info_url: "https://www.douban.com/doubanapp//h5/book/35658388/desc",
};

it("finds and imports books from Frodo without a logged-in web request", async () => {
	const context = createContext();
	// 分别模拟图书搜索、主详情、App 版本表以及公开短评的响应。
	request.mockImplementation(async ({url}) => {
		switch (new URL(url).pathname) {
			case "/api/v2/search/book":
				return {status: 200, json: {total: 21, items: [{
					target_type: "book", target: {...book, card_subtitle: "盖伊·哈雷"},
				}]}};
			case "/api/v2/book/35658388":
				return {status: 200, json: book};
			case "/doubanapp//h5/book/35658388/desc":
				return {status: 200, text: "<table>" +
					"<tr><td>ISBN</td><td>9787534198717</td></tr>" +
					"<tr><td>原作名</td><td>Dark Imperium: Plague War</td></tr>" +
					"<tr><td>装帧</td><td>平装</td></tr></table>"};
			case "/api/v2/book/35658388/interests":
				return {status: 200, json: {interests: [{comment: "公开短评"}]}};
			default:
				throw new Error("Unexpected book request");
		}
	});
	const web = jest.spyOn(DoubanHttpUtil, "httpRequestGet");
	const page = await SearcherV2.search(book.title, SupportType.book, 1, 20, context);
	expect(page.hasNext).toBe(true);
	expect(page.allowsAnonymousPagination).toBe(true);
	expect(page.list).toMatchObject([{id: book.id, title: book.title, type: SupportType.book,
		cast: "盖伊·哈雷", url: "https://book.douban.com/subject/35658388/"}]);

	const handler = new DoubanSearchChooseItemHandler(context.plugin.app, context.plugin);
	const subject = await handler.handle(page.list[0], context);
	expect(subject).toMatchObject({
		id: book.id, title: book.title, type: SupportType.book, desc: book.intro, datePublished: new Date(2021, 10, 1),
		author: book.author, translator: book.translator, publisher: "浙江科学技术出版社", series: "战锤40000",
		totalPage: 288, price: 55, isbn: "9787534198717", originalTitle: "Dark Imperium: Plague War",
		binding: "平装", subTitle: "纳垢战争", popularComments: ["公开短评"],
	});
	expect(web).not.toHaveBeenCalled();
	expect(request.mock.calls.map(([options]) => new URL(options.url).pathname).sort()).toEqual([
		"/api/v2/book/35658388", "/api/v2/book/35658388/interests",
		"/api/v2/search/book", "/doubanapp//h5/book/35658388/desc",
	]);
	expect(request.mock.calls.every(([options]) => !options.headers?.Cookie)).toBe(true);
	expect(context.plugin.putToObsidian).toHaveBeenCalledWith(context, subject);
});
