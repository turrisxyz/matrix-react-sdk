/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React, { Dispatch, ReactElement, SetStateAction, useState } from 'react';

import { _t } from "../../../languageHandler";
import SdkConfig from '../../../SdkConfig';
import AccessibleButton, { ButtonEvent } from '../elements/AccessibleButton';

enum Status {
    Ready,
    Translating,
    Translated,
    Failed,
}

interface IProps {
    text: string;
}

export function TranslateThis(props: IProps) {
    const [status, setStatus] = useState(Status.Ready);
    const [translation, setTranslation] = useState();

    switch (status) {
        case Status.Translated: return renderTranslated(translation);
        default: return renderButton(props.text, status, setStatus, setTranslation);
    }
}

/**
 * Decide whether we should offer a "translate this" button for a given
 * message.
 */
export function shouldOfferTranslation(messageSender: string, currentUser: string, messageText: string) {
    // Don't translate our own messages - if not our own, ask the translation
    // code whether this looks like text not in our own language.
    return messageSender !== currentUser && liltShouldOfferTranslation(messageText);
}

function renderButton(text: string, status: Status, setStatus: any, setTranslation: any): ReactElement {
    return <div className="mx_TranslateThis">
        <AccessibleButton
            onClick={onTranslateThisClick(text, setStatus, setTranslation)}
            className="mx_TranslateThis_button"
            disabled={status === Status.Translating}
        >
            { message(status) }
        </AccessibleButton>
    </div>;
}

function renderTranslated(translation: string): ReactElement {
    return <div className="mx_TranslateThis mx_TranslateThis_translated">
        <div className="mx_TranslateThis_translation">{ _t("Translation:") }</div>
        <div>{ translation }</div>
    </div>;
}

function onTranslateThisClick(
    text: string,
    setStatus: Dispatch<SetStateAction<Status>>,
    setTranslation: Dispatch<SetStateAction<string>>,
) {
    return async (_ev: ButtonEvent) => {
        setStatus(Status.Translating);

        setStatus(Status.Translating);
        const translation = await liltTranslate(text);

        if (translation !== null) {
            setTranslation(translation);
            setStatus(Status.Translated);
        } else {
            setTranslation(null);
            setStatus(Status.Failed);
        }
    };
}

function message(status: Status): string {
    switch (status) {
        case Status.Ready: return _t("Translate this");
        case Status.Translating: return _t("Translating ...");
        default: return _t("Translation failed. Try again?");
    }
}

// Lilt-specific code

const liltApiKey = SdkConfig.get().lilt_api_key;
const liltPollTimeMs = 100;
const liltMaxPolls = 20;

/*
 * Original, simpler way: do a GET request to https://lilt.com/2/translate?memory_id=69501&source=My%20message.
 * This works, but does not allow detecting the source message language.
 */

const liltUrls = {
    upload: "https://lilt.com/2/files?name=element_web.txt&langId=true",
    checkUpload: "https://lilt.com/2/files?id=FILE_ID",
    translate: `https://lilt.com/2/translate/file?memoryId=MEMORY_ID&fileId=FILE_ID`,
    checkTranslate: "https://lilt.com/2/translate/file?translationIds=TRANSLATION_ID",
    download: "https://lilt.com/2/translate/files?id=TRANSLATION_ID",
};

/**
 * This is the main thing we would need to fix to make this not just a
 * prototype: we have hard-coded a list of pre-created Memory objects
 * in Lilt, one for each source language, and all with a target language
 * of English.
 */
const liltMemories = {
    "fr": 69501,
    "de": 69706,
};

const englishSegments = [
    " all ",
    " and ",
    " from ",
    " had ",
    " has ",
    " thanks ",
    " that ",
    " the ",
    " this ",
    " yeah ",
];

function liltShouldOfferTranslation(messageText: string) {
    // Very dumb implementation: hard-coded to English as a target, and
    // only looks for certain letters and words to identify English text.

    const lc = messageText.toLowerCase();
    for (const segment of englishSegments) {
        if (lc.includes(segment.toLowerCase())) {
            return false;
        }
    }
    return true;
}

function sleepTime(pollNumber: number) {
    return liltPollTimeMs * Math.min(32, Math.pow(2, pollNumber + 1));
}

/**
 * Fetch from the supplied URL repeatedly, until the supplied function returns non-null.
 */
async function pollFor(
    url: string,
    headers: Headers,
    checkResponse: (json: object) => string | null,
): Promise<string | null> {
    for (let numPolls = 0; numPolls < liltMaxPolls; numPolls++) {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            console.warn(`Failed polling ${url}.`);
            return null;
        }

        const json = await response.json();
        const answer = checkResponse(json);
        if (answer !== null) {
            return answer as string;
        }

        await sleep(sleepTime(numPolls));
        numPolls++;
    }
    console.warn(`Gave up polling ${url}.`);
    return null;
}

async function liltTranslate(text: string): Promise<string | null> {
    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(`${liltApiKey}:${liltApiKey}`));

    const uploadHeaders = new Headers();
    uploadHeaders.set('Authorization', 'Basic ' + btoa(`${liltApiKey}:${liltApiKey}`));
    uploadHeaders.set('Content-Type', 'application/octet-stream');

    const responseUpload = await fetch(liltUrls.upload, { headers: uploadHeaders, method: "POST", body: text });
    if (!responseUpload.ok) {
        console.warn("Failed uploading text to translate.");
        return null;
    }
    const fileId = (await responseUpload.json()).id;

    const detectedLang = await pollFor(
        liltUrls.checkUpload.replace("FILE_ID", fileId),
        headers,
        (json: object) => json[0].detected_lang ?? null,
    );

    if (detectedLang === "und") {
        console.warn("Unable to detect the language of this message.");
        return null;
    }

    const memoryId = liltMemories[detectedLang];
    if (!memoryId) {
        if (detectedLang === null) {
            console.warn("API was unable to detect language for translation.");
        } else {
            console.warn(`Not set up to translate from ${detectedLang}.`);
        }
        return null;
    }

    const responseTranslate = await fetch(
        liltUrls.translate.replace("MEMORY_ID", memoryId).replace("FILE_ID", fileId),
        { headers, method: "POST" },
    );
    if (!responseTranslate.ok) {
        console.warn("Failed requesting translation of uploaded file.");
        return null;
    }
    const translationId = (await responseTranslate.json())[0].id;

    const translationStatus = await pollFor(
        liltUrls.checkTranslate.replace("TRANSLATION_ID", translationId),
        headers,
        (json: object) => json[0].status === "ReadyForDownload" ? json[0].status : null,
    );
    if (translationStatus !== "ReadyForDownload") {
        return null;
    }

    const responseDownload = await fetch(liltUrls.download.replace("TRANSLATION_ID", translationId), { headers });
    if (!responseDownload.ok) {
        console.warn("Failed downloading translation.");
        return null;
    }

    return await responseDownload.text();
}

async function sleep(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
