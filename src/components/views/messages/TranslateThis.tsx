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
    return liltShouldOfferTranslation(messageSender, currentUser, messageText);
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

const liltApiUrl = "https://lilt.com/2/translate?memory_id=69501&source=";
const liltApiKey = SdkConfig.get().lilt_api_key;

function liltShouldOfferTranslation(messageSender: string, currentUser: string, _messageText: string) {
    // Offer to translate all messages that were not sent by us.
    return (messageSender !== currentUser);
}

async function liltTranslate(text: string): Promise<string | null> {
    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(`${liltApiKey}:${liltApiKey}`));

    const url = liltApiUrl + encodeURIComponent(text);

    const response = await fetch(url, { headers });

    if (response.ok) {
        const j = await response.json();
        return j[0];
    } else {
        return null;
    }
}
