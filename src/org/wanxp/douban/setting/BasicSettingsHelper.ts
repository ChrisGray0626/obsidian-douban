import I18nHelper, {i18nHelper} from "../../lang/helper";
import {Platform, SecretComponent, Setting} from "obsidian";
import {DEFAULT_SETTINGS} from "../../constant/DefaultSettings";
import SettingsManager from "./SettingsManager";
import DoubanLoginModel from "../component/DoubanLoginModel";
import DoubanLogoutModel from "../component/DoubanLogoutModel";
import User from "../user/User";
import {createFolderSelectionSetting} from "./TemplateSettingHelper";
import StringUtil from "../../utils/StringUtil";
import {log} from "../../utils/Logutil";
import DoubanPlugin from "../../main";
import {SearchTypeRecords, SupportType, SupportTypeMap} from "../../constant/Constsant";

export function constructBasicUI(containerEl: HTMLElement, manager: SettingsManager) {
	// containerEl.createEl('h3', { text: i18nHelper.getMessage('1210') });


	new Setting(containerEl).setName(i18nHelper.getMessage('120501')).then((setting) => {
		setting.addMomentFormat((mf) => {
			setting.descEl.appendChild(
				createFragment((frag) => {
					frag.appendText(
						i18nHelper.getMessage('120503')
					);
					frag.createEl('br');
					frag.appendText(i18nHelper.getMessage('120506') + ' ');
					frag.createEl(
						'a',
						{
							text: i18nHelper.getMessage('120508'),
							href: 'https://momentjs.com/docs/#/displaying/format/',
						},
						(a) => {
							a.setAttr('target', '_blank');
						}
					);
					frag.createEl('br');
					frag.appendText(i18nHelper.getMessage('120507') + ': ');
					mf.setSampleEl(frag.createEl('b', {cls: 'u-pop'}));
					frag.createEl('br');
				})
			);
			mf.setPlaceholder(DEFAULT_SETTINGS.dateFormat);
			mf.setValue(manager.plugin.settings.dateFormat)
			mf.onChange(async (value) => {
				manager.plugin.settings.dateFormat = value;
				await manager.plugin.saveSettings();
			});

		});
	});

	new Setting(containerEl).setName(i18nHelper.getMessage('120502')).then((setting) => {
		setting.addMomentFormat((mf) => {
			setting.descEl.appendChild(
				createFragment((frag) => {
					frag.appendText(
						i18nHelper.getMessage('120504')
					);
					frag.createEl('br');
					frag.appendText(i18nHelper.getMessage('120506') + ' ');
					frag.createEl(
						'a',
						{
							text: i18nHelper.getMessage('120508'),
							href: 'https://momentjs.com/docs/#/displaying/format/',
						},
						(a) => {
							a.setAttr('target', '_blank');
						}
					);
					frag.createEl('br');
					frag.appendText(i18nHelper.getMessage('120507') + ': ');
					mf.setSampleEl(frag.createEl('b', {cls: 'u-pop'}));
					frag.createEl('br');
				})
			);
			mf.setPlaceholder(DEFAULT_SETTINGS.timeFormat);
			mf.setValue(manager.plugin.settings.timeFormat)
			mf.onChange(async (value) => {
				manager.plugin.settings.timeFormat = value;
				await manager.plugin.saveSettings();
			});

		});
	});

	new Setting(containerEl)
		.setName(i18nHelper.getMessage('121401'))
		.setDesc(i18nHelper.getMessage('121402'))
		.addToggle((toggleComponent) => {
			toggleComponent
				// .setTooltip(i18nHelper.getMessage('121403'))
				.setValue(manager.plugin.settings.statusBar)
				.onChange(async (value) => {
					manager.plugin.settings.statusBar = value;
					await manager.plugin.saveSettings();
				});
		});

	new Setting(containerEl)
		.setName(i18nHelper.getMessage('121410'))
		.setDesc(i18nHelper.getMessage('121411'))
		.addDropdown((dropdown) => {
			dropdown
				.addOptions(SearchTypeRecords)
				.setValue(manager.plugin.settings.searchDefaultType)
				.onChange(async (value) => {
					// @ts-ignore
					manager.plugin.settings.searchDefaultType = SupportTypeMap[value];
					await manager.plugin.saveSettings();
				});
		});

	// 旧版 Obsidian 可以使用内置凭据，只有提供密钥库组件的版本才显示自定义入口。
	if (manager.plugin.app.secretStorage) {
		// 每行依次是设置字段、界面标题和说明文案的键。
		const fields = [
			["frodoApiKeySecretId", "frodoApiKey", "frodoApiKeyDesc"],
			["frodoSigningSecretId", "frodoSigningSecret", "frodoSigningSecretDesc"],
		] as const;
		for (const [key, name, desc] of fields) {
			const setting = new Setting(containerEl)
				.setName(i18nHelper.getMessage(name))
				.setDesc(i18nHelper.getMessage(desc));
			new SecretComponent(manager.plugin.app, setting.controlEl)
				.setValue(manager.plugin.settings[key])
				.onChange(async value => {
					// 组件返回所选密钥的 ID。清空选择时，客户端会重新采用内置凭据。
					manager.plugin.settings[key] = value || "";
					await manager.plugin.saveSettings();
				});
		}
	}

}

