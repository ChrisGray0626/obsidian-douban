jest.mock("obsidian", () => ({
	getLanguage: () => "en",
	moment: () => ({format: () => "2026-11-25"}),
	normalizePath: (path: string) => path,
	Notice: jest.fn(),
	Platform: {get isDesktopApp() { return true; }},
}), {virtual: true});

import {Notice, Platform} from "obsidian";
import {SearchHandleMode, SupportType} from "../src/org/wanxp/constant/Constsant";
import {DEFAULT_SETTINGS} from "../src/org/wanxp/constant/DefaultSettings";
import DoubanAbstractLoadHandler from "../src/org/wanxp/douban/data/handler/DoubanAbstractLoadHandler";
import DoubanMovieLoadHandler from "../src/org/wanxp/douban/data/handler/DoubanMovieLoadHandler";
import DoubanMovieSubject from "../src/org/wanxp/douban/data/model/DoubanMovieSubject";
import HandleContext from "../src/org/wanxp/douban/data/model/HandleContext";
import FileHandler from "../src/org/wanxp/file/FileHandler";
import NetFileHandler from "../src/org/wanxp/net/NetFileHandler";
import {ClipboardUtil} from "../src/org/wanxp/utils/ClipboardUtil";
import HttpUtil from "../src/org/wanxp/utils/HttpUtil";
import {HttpResponse} from "../src/org/wanxp/utils/model/HttpResponse";

const imageUrl = "https://img1.doubanio.com/view/photo/l/public/p123.jpg";
const uploadUrl = "http://127.0.0.1:36677/upload";
const heartbeatUrl = "http://127.0.0.1:36677/heartbeat";
const buffer = new Uint8Array([255, 216, 255, 217]).buffer;

function setup() {
	const settings = {
		...DEFAULT_SETTINGS,
		attachmentPath: "assets",
		cacheImage: true,
		cacheHighQuantityImage: false,
		pictureBedFlag: true,
		pictureBedSetting: {url: uploadUrl},
	};
	const plugin = {settingsManager: {
		getHeaders: () => ({}),
		getSetting: (key: keyof typeof settings) => settings[key],
	}};
	const writeAttachment = jest.fn();
	const fileHandler = {creatAttachmentWithData: writeAttachment} as unknown as FileHandler;
	const context = {
		plugin, settings, netFileHandler: new NetFileHandler(fileHandler),
		mode: SearchHandleMode.FOR_CREATE, userComponent: {isLogin: () => false},
	} as unknown as HandleContext;
	const download = jest.spyOn(HttpUtil, "httpRequestBuffer")
		.mockResolvedValue(new HttpResponse(200, {"content-type": "image/jpeg"}, buffer));
	const request = jest.spyOn(HttpUtil, "httpRequest")
		.mockResolvedValueOnce(new HttpResponse(200, {}, '{"success":true}'));
	jest.spyOn(ClipboardUtil, "writeImage").mockResolvedValue(undefined);
	jest.spyOn(console, "log").mockImplementation(() => undefined);
	jest.spyOn(console, "error").mockImplementation(() => undefined);

	const handler = new DoubanMovieLoadHandler(context.plugin);
	jest.spyOn(DoubanAbstractLoadHandler.prototype as any, "getTemplate")
		.mockResolvedValue("![cover]({{image}})");
	const subject = Object.assign(new DoubanMovieSubject(), {
		id: "1292052", title: "cover", type: SupportType.movie, image: imageUrl, imageUrl,
	});
	return {context, download, request, writeAttachment, handler, subject};
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

it("uses a 60-second PicGo upload timeout and keeps the original link if it expires", async () => {
	const {context, request, writeAttachment, handler, subject} = setup();
	request.mockRejectedValueOnce(new Error("Request timed out after 60000ms"));

	await expect(handler.parse(subject, context)).resolves.toMatchObject({content: "![cover](" + imageUrl + ")"});
	expect(request).toHaveBeenNthCalledWith(1, heartbeatUrl, {}, context.plugin.settingsManager, {method: "post"});
	expect(request).toHaveBeenNthCalledWith(2, uploadUrl, {}, context.plugin.settingsManager, {method: "post", timeoutMs: 60_000});
	expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Request timed out after 60000ms"));
	expect(writeAttachment).not.toHaveBeenCalled();
});

it.each([true, false])("reports unavailable PicGo without saving an attachment (desktop: %s)", async isDesktop => {
	jest.spyOn(Platform, "isDesktopApp", "get").mockReturnValue(isDesktop);
	const {context, download, request, writeAttachment, handler, subject} = setup();
	request.mockReset().mockResolvedValueOnce(new HttpResponse(503, {}, '{}'));

	await expect(handler.parse(subject, context)).resolves.toMatchObject({content: "![cover](" + imageUrl + ")"});
	expect(Notice).toHaveBeenCalledWith(expect.stringContaining("PicGo is unavailable."));
	expect(request).toHaveBeenCalledTimes(isDesktop ? 1 : 0);
	expect(download).not.toHaveBeenCalled();
	expect(writeAttachment).not.toHaveBeenCalled();
});
