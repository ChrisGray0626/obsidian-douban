import {SupportType} from "../../../constant/Constsant";
import type DoubanSubject from "../model/DoubanSubject";
import type HandleContext from "../model/HandleContext";
import type {DoubanFrodoClient, FrodoSubjectType} from "./DoubanFrodoClient";
import type {DoubanSubjectLoader} from "./DoubanSubjectLoader";
import {DoubanWebSubjectLoader, type UserStateParser} from "./DoubanWebSubjectLoader";

export class DoubanFrodoSubjectLoader implements DoubanSubjectLoader {
	constructor(
		private readonly client: DoubanFrodoClient,
		private readonly type: FrodoSubjectType,
		private readonly getUserStateParser: (subject: DoubanSubject) => UserStateParser,
	) {
	}

	async load(id: string, context: HandleContext): Promise<DoubanSubject> {
		// 图书有独立的详情接口，影视客户端根据条目类型选择电影或电视剧接口。
		const subject = this.type === SupportType.book
			? await this.client.bookDetail(id)
			: await this.client.detail(id, this.type, context.settings.personNameMode);

		// 影视链接共用同一种格式。以详情返回的类型选择网页个人记录解析器。
		const parser = this.getUserStateParser(subject);
		subject.userState = await DoubanWebSubjectLoader.loadUserState(subject.id, context, parser);
		return subject;
	}
}
