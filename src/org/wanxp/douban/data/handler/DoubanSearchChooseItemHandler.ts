import {App} from "obsidian";
import {i18nHelper} from "../../../lang/helper";
import {log} from "../../../utils/Logutil";
import {DoubanFrodoClient} from "./DoubanFrodoClient";
import {DoubanFrodoSubjectLoader} from "./DoubanFrodoSubjectLoader";
import type {DoubanSubjectLoader} from "./DoubanSubjectLoader";
import type DoubanAbstractLoadHandler from "./DoubanAbstractLoadHandler";
import {DoubanWebSubjectLoader} from "./DoubanWebSubjectLoader";

import DoubanBookLoadHandler from "./DoubanBookLoadHandler";
import DoubanMovieLoadHandler from "./DoubanMovieLoadHandler";
import DoubanMusicLoadHandler from "./DoubanMusicLoadHandler";
import DoubanNoteLoadHandler from "./DoubanNoteLoadHandler";
import DoubanOtherLoadHandler from "./DoubanOtherLoadHandler";
import DoubanPlugin from "../../../main";
import DoubanSubject from "../model/DoubanSubject";
import DoubanSubjectLoadHandler from "./DoubanSubjectLoadHandler";
import {DoubanTeleplayLoadHandler} from "./DoubanTeleplayLoadHandler";
import DoubanGameLoadHandler from "./DoubanGameLoadHandler";
import HandleContext from "../model/HandleContext";
import HandleResult from "../model/HandleResult";
import DoubanTheaterLoadHandler from "./DoubanTheaterLoadHandler";

export class DoubanSearchChooseItemHandler {

	private _app: App;
	private _doubanPlugin: DoubanPlugin;
	private _doubanSubjectHandlers: DoubanAbstractLoadHandler<DoubanSubject>[];
	private _doubanSubjectHandlerDefault: DoubanAbstractLoadHandler<DoubanSubject>;


	constructor(app: App, doubanPlugin: DoubanPlugin) {
		this._app = app;
		this._doubanPlugin = doubanPlugin;
		this._doubanSubjectHandlerDefault = new DoubanOtherLoadHandler(doubanPlugin);
		this._doubanSubjectHandlers = [new DoubanTheaterLoadHandler(doubanPlugin), new DoubanMovieLoadHandler(doubanPlugin), new DoubanBookLoadHandler(doubanPlugin),
			new DoubanTeleplayLoadHandler(doubanPlugin),
			new DoubanMusicLoadHandler(doubanPlugin),
			new DoubanNoteLoadHandler(doubanPlugin),
			new DoubanGameLoadHandler(doubanPlugin),
			this._doubanSubjectHandlerDefault];
	}

	public async handle(searchExtract: DoubanSubject, context: HandleContext): Promise<DoubanSubject | void> {
		if (!searchExtract) {
			return;
		}
		const handler = this.getHandler(searchExtract);
		const type = handler.getSupportType();
		try {
			// 资源处理器先识别标准类型，导入入口据此选择详情加载策略。
			const loader: DoubanSubjectLoader = DoubanFrodoClient.supports(type)
				? new DoubanFrodoSubjectLoader(
					DoubanFrodoClient.fromSettings(this._app, context.settings), type, subject => this.getHandler(subject),
				)
				: new DoubanWebSubjectLoader(handler);
			const subject = await loader.load(searchExtract.id, context);
			await this._doubanPlugin.putToObsidian(context, subject);
			return subject;
		} catch (e) {
			log.error(i18nHelper.getMessage("130101", e.message), e);
		}
	}

	private getHandler(subject: DoubanSubject): DoubanAbstractLoadHandler<DoubanSubject> {
		return this._doubanSubjectHandlers.find(handler => handler.support(subject)) ?? this._doubanSubjectHandlerDefault;
	}

	public async parseText(extract: DoubanSubject, context: HandleContext): Promise<HandleResult> {
		const doubanSubjectHandlers: DoubanSubjectLoadHandler<DoubanSubject>[] = this._doubanSubjectHandlers
			.filter(h => h.support(extract));
		if (doubanSubjectHandlers && doubanSubjectHandlers.length > 0) {
			const result = await doubanSubjectHandlers.map(h => h.parse(extract, context));
			if (result && result.length > 0) {
				return result[0];
			} else {
				return {content: ''};
			}
		} else {
			return this._doubanSubjectHandlerDefault.parse(extract, context);
		}

	}

}
