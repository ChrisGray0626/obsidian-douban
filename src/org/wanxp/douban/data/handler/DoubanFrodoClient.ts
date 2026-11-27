import {App, requestUrl} from "obsidian";
import {Person} from "schema-dts";
import {load} from "cheerio";
import {PersonNameMode, SupportType} from "../../../constant/Constsant";
import {i18nHelper} from "../../../lang/helper";
import {DoubanPluginSetting} from "../../setting/model/DoubanPluginSetting";
import DoubanSearchResultSubject from "../model/DoubanSearchResultSubject";
import DoubanSubject from "../model/DoubanSubject";
import DoubanBookSubject from "../model/DoubanBookSubject";
import DoubanTeleplaySubject from "../model/DoubanTeleplaySubject";
import {SearchPage} from "../model/SearchPage";

interface FrodoPerson {
	name?: string;
	latin_name?: string;
}

// 搜索结果和详情 JSON 共用这些字段。后面的转换方法将它们映射到插件条目模型。
interface FrodoSubject {
	id?: string | number;
	title?: string;
	type?: string;
	subtype?: string;
	uri?: string;
	intro?: string;
	abstract?: string;
	card_subtitle?: string;
	original_title?: string;
	release_date?: string;
	pubdate?: string[];
	rating?: {value?: number; count?: number};
	pic?: {large?: string; normal?: string};
	cover_url?: string;
	cover?: {url?: string};
	directors?: FrodoPerson[];
	actors?: FrodoPerson[];
	writers?: FrodoPerson[];
	genres?: string[];
	countries?: string[];
	languages?: string[];
	aka?: string[];
	durations?: string[];
	episodes_count?: number;
	imdb_id?: string;
}

// /book/{id} 返回的图书详情 JSON。转换后才交给笔记模板。
interface FrodoBook extends FrodoSubject {
	author?: string[];
	translator?: string[];
	press?: string[];
	producers?: string[];
	pages?: string[];
	price?: string[];
	book_subtitle?: string;
	book_series?: {title: string};
	catalog?: string;
	info_url?: string;
}

// /book/{id}/interests 的公开短评响应。模板通过 {{popularComments}} 使用其中的 comment。
interface FrodoBookInterests {
	interests: {comment?: string}[];
}

// Frodo 把每个实际条目放在 items[].target 中。total 用于判断还有没有下一页。
interface FrodoSearchResponse {
	items: {type_name?: string; target_type?: string; target?: FrodoSubject}[];
	total: number;
}

type FilmType = SupportType.movie | SupportType.teleplay;
export type FrodoSubjectType = FilmType | SupportType.book;

export class DoubanFrodoClient {
	private static readonly baseUrl = "https://frodo.douban.com/api/v2";

	// Shared application credentials used by MoviePilot v3.2.13.
	private static readonly defaultApiKey = "0dad551ec0f84ed02907ff5c42e8ec70";
	private static readonly defaultSigningSecret = "bf7dddc7c9cfe6f7";
	private static readonly userAgent = "api-client/1 com.douban.frodo/7.3.0(207) Android/22 product/MI 9 vendor/Xiaomi model/MI 9 brand/Android  rom/miui6  network/wifi platform/mobile nd/1";

	private constructor(private readonly apiKey: string, private readonly signingSecret: string) {
	}

	// 搜索分类与导入条目的标准类型共用 Frodo 覆盖范围。
	static supports(type: SupportType): type is FrodoSubjectType {
		return type === SupportType.movie || type === SupportType.teleplay || type === SupportType.book;
	}

	static fromSettings(app: App, settings: DoubanPluginSetting): DoubanFrodoClient {
		// 两个设置项都是密钥库 ID。旧版没有密钥库时可以直接走默认凭据。
		const storage = app.secretStorage;
		const apiKey = settings.frodoApiKeySecretId && storage?.getSecret(settings.frodoApiKeySecretId)?.trim();
		const signingSecret = settings.frodoSigningSecretId && storage?.getSecret(settings.frodoSigningSecretId)?.trim();
		// API Key 和签名密钥属于同一个应用，两项都可用时才一起切换。
		if (apiKey && signingSecret) {
			return new DoubanFrodoClient(apiKey, signingSecret);
		}
		return new DoubanFrodoClient(this.defaultApiKey, this.defaultSigningSecret);
	}

	async search(keyword: string, type: FrodoSubjectType, pageNum: number, pageSize: number): Promise<SearchPage> {
		const query = keyword.trim();
		if (!query) {
			return SearchPage.empty(type);
		}
		// 弹窗页码从 1 开始，Frodo 的 start 从 0 开始计数。例如每页 20 条时第二页从 20 开始。
		const start = (pageNum - 1) * pageSize;
		// 图书用专用搜索。影视用综合接口，并在下面只保留电影或电视剧条目。
		const bookSearch = type === SupportType.book;
		const response = await this.get<FrodoSearchResponse>(bookSearch ? "/search/book" : "/search/weixin", {
			q: query,
			start: String(start),
			count: String(pageSize),
		});
		if (!response || !Array.isArray(response.items)) {
			throw new Error(i18nHelper.getMessage("frodoInvalidResponse"));
		}
		const list: DoubanSearchResultSubject[] = [];
		// 综合响应还会带其他类别和推荐卡片。可导入条目至少需要匹配的类型、ID 和标题。
		for (const {target, type_name, target_type} of response.items) {
			const subjectType: FrodoSubjectType | undefined = bookSearch ? SupportType.book : this.getType(target, type_name);
			if (!target?.id || !target.title?.trim() || !subjectType
				|| (bookSearch && target_type !== "book")
				|| (type === SupportType.teleplay && subjectType !== type)) {
				continue;
			}
			const subject = subjectType === SupportType.book ? this.toBookSearchResult(target)
				: this.toSubject(target, subjectType, PersonNameMode.CH_NAME);
			list.push({...subject, cast: target.card_subtitle || (target.actors || []).map(person => person.name).filter(Boolean).join(" / ")});
		}
		// 接口返回空页时以当前偏移量为边界，避免仍根据接口总数显示下一页。
		const total = response.items.length ? response.total : start;
		return new SearchPage(total, pageNum, pageSize, type, list, true);
	}

	async detail(id: string, type: FilmType, personNameMode: string): Promise<DoubanTeleplaySubject> {
		// 电影和电视剧的网页链接格式相同。首选详情接口返回 404 时再尝试另一种类型。
		const alternateType: FilmType = type === SupportType.movie ? SupportType.teleplay : SupportType.movie;
		for (const detailType of [type, alternateType]) {
			const path = detailType === SupportType.teleplay ? "tv" : "movie";
			const subject = await this.get<FrodoSubject>("/" + path + "/" + encodeURIComponent(id));
			if (!subject) {
				continue;
			}
			// 接口有响应但条目不匹配时停止导入，避免把其他作品写进笔记。
			if (String(subject.id) !== id || !subject.title?.trim()) {
				break;
			}
			return this.toSubject(subject, this.getType(subject) ?? detailType, personNameMode);
		}
		throw new Error(i18nHelper.getMessage("frodoInvalidResponse"));
	}

	async bookDetail(id: string): Promise<DoubanBookSubject> {
		// 先用搜索结果或导入链接里的豆瓣 ID 获取公开图书详情。
		const path = "/book/" + encodeURIComponent(id);
		const data = await this.get<FrodoBook>(path);
		// ID 和标题是创建笔记的前提，避免把错误响应保存为图书笔记。
		if (!data || String(data.id) !== id || !data.title?.trim()) {
			throw new Error(i18nHelper.getMessage("frodoInvalidResponse"));
		}
		// 主详情到手后并行补充版本字段和热门短评。某项请求失败时，对应字段留空。
		const [edition, comments] = await Promise.all([
			// info_url 是 Frodo 随主详情返回的 App 版本信息页链接。
			this.getBookEdition(data.info_url).catch(() => new Map<string, string>()),
			this.get<FrodoBookInterests>(path + "/interests", {start: "0", count: "5", order_by: "hot"})
				.catch((): null => null),
		]);
		// Frodo 可能只给年份或年月。缺少月份或日时补 1，供模板生成日期及年份。
		const publication = data.pubdate?.[0]?.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
		const image = data.pic?.large || data.cover_url || "";
		return {
			// 复用搜索结果中的 ID、标题、评分和条目 URL，再填入详情字段。
			...this.toBookSearchResult(data),
			image,
			imageUrl: image,
			desc: data.intro || "",
			datePublished: publication
				? new Date(Number(publication[1]), Number(publication[2] || 1) - 1, Number(publication[3] || 1))
				: undefined,
			author: data.author || [],
			translator: data.translator || [],
			// Frodo 可返回多个出版社或出品方，模板使用以斜杠分隔的文本。
			publisher: (data.press || []).join(" / "),
			producer: (data.producers || []).join(" / "),
			// 这三项取自 App 页面的版本表，主详情 JSON 未直接提供。
			isbn: edition.get("ISBN") || "",
			originalTitle: edition.get("原作名") || "",
			binding: edition.get("装帧") || "",
			subTitle: data.book_subtitle || "",
			// 页数和价格在响应里是字符串数组，例如 ["288"] 和 ["55元"]。
			totalPage: data.pages?.[0] ? Number(data.pages[0]) : null,
			price: data.price?.[0] ? Number.parseFloat(data.price[0]) : null,
			series: data.book_series?.title || "",
			menu: (data.catalog || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean),
			// 只保留正文，去掉空白和重复短评，供自定义模板按需引用。
			popularComments: Array.from(new Set(
				(comments?.interests || []).map(item => item.comment?.trim()).filter(Boolean),
			)),
		};
	}

	private async getBookEdition(url: string): Promise<Map<string, string>> {
		const fields = new Map<string, string>();
		// 只跟随指向豆瓣 App 页面的链接。
		if (!url?.startsWith("https://www.douban.com/doubanapp/")) {
			return fields;
		}
		const response = await requestUrl({url, throw: false});
		if (response.status === 200) {
			const html = load(response.text);
			// 每行的第一列是字段名，第二列是值，例如 ISBN 和对应书号。
			html("tr").each((_index, row) => {
				const cells = html(row).children("td");
				fields.set(cells.eq(0).text().trim(), cells.eq(1).text().trim());
			});
		}
		return fields;
	}

	private async get<T>(path: string, query: Record<string, string> = {}): Promise<T | null> {
		const url = new URL(DoubanFrodoClient.baseUrl + path);
		// Frodo 的 _ts 是 YYYYMMDD 格式的请求签名日期。
		const date = new Date();
		const timestamp = [
			date.getFullYear(),
			String(date.getMonth() + 1).padStart(2, "0"),
			String(date.getDate()).padStart(2, "0"),
		].join("");
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey("raw", encoder.encode(this.signingSecret),
			{name: "HMAC", hash: "SHA-1"}, false, ["sign"]);
		// 签名输入依次是 HTTP 方法、编码后的接口路径和日期。搜索词与分页参数另放到 URL 中。
		const message = encoder.encode(["GET", encodeURIComponent(url.pathname), timestamp].join("&"));
		const signature = await crypto.subtle.sign("HMAC", key, message);
		url.search = new URLSearchParams({
			...query,
			apiKey: this.apiKey,
			os_rom: "android",
			_ts: timestamp,
			_sig: btoa(String.fromCharCode(...new Uint8Array(signature))),
		}).toString();

		try {
			const response = await requestUrl({
				url: url.toString(),
				headers: {Accept: "application/json", "User-Agent": DoubanFrodoClient.userAgent},
				throw: false,
			});
			// 404 表示该资源类型下没有条目，影视详情可以据此尝试另一个接口。
			if (response.status === 404) {
				return null;
			}
			if (response.status === 200) {
				return response.json as T;
			}
		} catch (_error) {
			// Obsidian request errors can include the URL, which contains the application key.
		}
		throw new Error(i18nHelper.getMessage("frodoRequestFailed"));
	}

	// 搜索卡片通常用 type_name 标识类型，详情还可能通过 subtype、type 或条目 URI 提供。
	private getType(subject?: FrodoSubject, resultType?: string): FilmType | undefined {
		const type = subject?.subtype || subject?.type;
		if (type === "tv" || resultType === "电视剧" || subject?.uri?.includes("/tv/")) {
			return SupportType.teleplay;
		}
		if (type === "movie" || resultType === "电影" || subject?.uri?.includes("/movie/")) {
			return SupportType.movie;
		}
		return undefined;
	}

	// 生成搜索和详情共用的基础字段。笔记中的 URL 指向用户可以打开的图书条目页。
	private toBookSearchResult(data: FrodoSubject): DoubanSubject {
		const id = String(data.id);
		const image = data.cover_url || "";
		return {
			id,
			title: data.title.trim(),
			type: SupportType.book,
			score: data.rating?.value,
			image,
			imageUrl: image,
			url: "https://book.douban.com/subject/" + id + "/",
			desc: data.abstract || "",
			publisher: "",
			datePublished: undefined,
			genre: [],
		};
	}

	private toSubject(data: FrodoSubject, type: FilmType, personNameMode: string): DoubanTeleplaySubject {
		const id = String(data.id);
		const image = data.pic?.large || data.pic?.normal || data.cover_url || data.cover?.url || "";
		// 优先使用 release_date，其次取第一条可解析的 pubdate。地区上映日期可能晚于作品年份。
		const releaseDate = [data.release_date, ...(data.pubdate || [])]
			.map(value => value?.match(/^\d{4}(?:-\d{2}-\d{2})?/)?.[0])
			.find(Boolean);
		const score = data.rating?.value;
		return {
			id,
			type,
			title: data.title.trim(),
			originalTitle: data.original_title?.trim() || data.title.trim(),
			url: "https://movie.douban.com/subject/" + id + "/",
			desc: data.intro || "",
			publisher: "",
			score,
			aggregateRating: score == null ? undefined : {
				"@type": "AggregateRating",
				ratingValue: score,
				ratingCount: data.rating.count,
			},
			datePublished: releaseDate ? new Date(releaseDate) : undefined,
			image,
			imageUrl: image,
			director: this.toPeople(data.directors, personNameMode),
			actor: this.toPeople(data.actors, personNameMode),
			author: this.toPeople(data.writers, personNameMode),
			genre: data.genres || [],
			country: data.countries || [],
			language: data.languages || [],
			aliases: data.aka || [],
			time: data.durations?.[0] || "",
			episode: data.episodes_count ? String(data.episodes_count) : "",
			IMDb: data.imdb_id || "",
		};
	}

	// 按人名设置选显示名，再转换成模板处理器使用的 Schema.org Person 结构。
	private toPeople(people: FrodoPerson[] = [], mode: string): Person[] {
		return people.map(person => mode === PersonNameMode.EN_NAME
			? person.latin_name || person.name : person.name || person.latin_name)
			.filter(Boolean)
			.map(name => ({"@type": "Person", name}));
	}
}
