import {CheerioAPI, load} from "cheerio";
import {SupportType} from "../../../constant/Constsant";
import {DoubanSubjectStateRecords_KEY_WORD_TYPE} from "../../../constant/DoubanUserState";
import {i18nHelper} from "../../../lang/helper";
import {DoubanHttpUtil} from "../../../utils/DoubanHttpUtil";
import {log} from "../../../utils/Logutil";
import type SettingsManager from "../../setting/SettingsManager";
import type DoubanSubject from "../model/DoubanSubject";
import type HandleContext from "../model/HandleContext";
import type {UserStateSubject} from "../model/UserStateSubject";
import type {DoubanSubjectLoader} from "./DoubanSubjectLoader";

export interface UserStateParser {
	getSubjectUrl(id: string): string;
	analysisUserState(html: CheerioAPI, context: HandleContext): {data: CheerioAPI, userState: UserStateSubject};
}

interface WebSubjectParser<T extends DoubanSubject> extends UserStateParser {
	getSupportType(): SupportType;
	parseSubjectFromHtml(html: CheerioAPI, context: HandleContext): T | undefined;
}

export class DoubanWebSubjectLoader<T extends DoubanSubject> implements DoubanSubjectLoader<T> {
	constructor(private readonly parser: WebSubjectParser<T>) {
	}

	async load(id: string, context: HandleContext): Promise<T> {
		const url = this.parser.getSubjectUrl(id);
		const {settingsManager} = context.plugin;
		settingsManager.debug('开始请求地址:' + url);
		settingsManager.debug('(注意:请勿向任何人透露你的Cookie,此处若需要截图请**打码**)请求header:' + context.settings.loginHeadersContent);
		const page = await DoubanWebSubjectLoader.loadSubjectPage(url, settingsManager);

		// 网页详情与个人记录来自同一份 HTML，共用一次请求和现有资源解析器。
		const {data, userState} = this.parser.analysisUserState(page, context);
		const guessType = context.syncActive ? this.getGuessType(data) : this.parser.getSupportType();
		const subject = this.parser.parseSubjectFromHtml(data, context);
		if (!subject || !String(subject.id || '').trim() || !String(subject.title || '').trim()) {
			throw new Error(i18nHelper.getMessage('130113'));
		}
		subject.userState = userState;
		subject.guessType = guessType;
		return subject;
	}

	// 同步列表的分类可能与详情不同，按网页里的收藏文案识别资源类型。
	private getGuessType(data: CheerioAPI): SupportType {
		const text = data?.html();
		if (text) {
			for (const [keyword, type] of DoubanSubjectStateRecords_KEY_WORD_TYPE) {
				if (text.indexOf(keyword) >= 0) {
					return type;
				}
			}
		}
		return null;
	}

	// 网页详情导入和个人记录读取共用豆瓣网页请求及 HTML 解析。
	static async loadSubjectPage(url: string, settingsManager: SettingsManager): Promise<CheerioAPI> {
		const html = await DoubanHttpUtil.httpRequestGet(url, settingsManager.getHeaders(), settingsManager);
		return load(html);
	}

	static async loadUserState(id: string, context: HandleContext, parser: UserStateParser): Promise<UserStateSubject> {
		if (!context.userComponent.isLogin()) {
			return null;
		}
		try {
			// 资源处理器负责选择条目 URL，并按资源类型解释当前账号的字段。
			const page = await this.loadSubjectPage(parser.getSubjectUrl(id), context.plugin.settingsManager);
			return parser.analysisUserState(page, context).userState;
		} catch (_error) {
			// 网页会话失效时，导入入口仍可保存已取得的公开条目。
			log.warn(i18nHelper.getMessage("frodoUserStateUnavailable"));
			return null;
		}
	}
}
