// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.
import * as fs from "fs";
import * as sdk from "../../microsoft.cognitiveservices.speech.sdk";
import { ConsoleLoggingListener, WebsocketMessageAdapter } from "../../src/common.browser/Exports";
import { Events, EventType, PlatformEvent } from "../../src/common/Exports";

import { Settings } from "../Settings";
import { WaveFileAudioInput } from "../WaveFileAudioInputStream";

import { WaitForCondition } from "../Utilities";

let objsToClose: any[];

beforeAll(() => {
    // override inputs, if necessary
    Settings.LoadSettings();
    Events.instance.attachListener(new ConsoleLoggingListener(EventType.Debug));
});

beforeEach(() => {
    objsToClose = [];
    // tslint:disable-next-line:no-console
    console.info("------------------Starting test case: " + expect.getState().currentTestName + "-------------------------");
    // tslint:disable-next-line:no-console
    console.info("Start Time: " + new Date(Date.now()).toLocaleString());
});

afterEach(() => {
    // tslint:disable-next-line:no-console
    console.info("End Time: " + new Date(Date.now()).toLocaleString());
    objsToClose.forEach((value: any, index: number, array: any[]) => {
        if (typeof value.close === "function") {
            value.close();
        }
    });
});

const BuildSpeechConfig: () => sdk.SpeechTranslationConfig = (): sdk.SpeechTranslationConfig => {
    const s: sdk.SpeechTranslationConfig = sdk.SpeechTranslationConfig.fromSubscription(Settings.SpeechSubscriptionKey, Settings.SpeechRegion);
    expect(s).not.toBeUndefined();
    return s;
};
/*

// Tests client reconnect after speech timeouts.
test("Reconnect After timeout", (done: jest.DoneCallback) => {
    // tslint:disable-next-line:no-console
    console.info("Name: Reconnect After timeout");

    if (!Settings.ExecuteLongRunningTestsBool) {
        // tslint:disable-next-line:no-console
        console.info("Skipping test.");
        done();
        return;
    }

    // Pump valid speech and then silence until at least one speech end cycle hits.
    const fileBuffer: ArrayBuffer = WaveFileAudioInput.LoadArrayFromFile(Settings.WaveFile);

    const alternatePhraseFileBuffer: ArrayBuffer = WaveFileAudioInput.LoadArrayFromFile(Settings.LuisWaveFile);

    let p: sdk.PullAudioInputStream;
    let s: sdk.SpeechTranslationConfig;
    if (undefined === Settings.SpeechTimeoutEndpoint || undefined === Settings.SpeechTimeoutKey) {
        // tslint:disable-next-line:no-console
        console.warn("Running timeout test against production, this will be very slow...");
        s = BuildSpeechConfig();
    } else {
        s = sdk.SpeechTranslationConfig.fromEndpoint(new URL(Settings.SpeechTimeoutEndpoint), Settings.SpeechTimeoutKey);
    }
    objsToClose.push(s);

    s.addTargetLanguage(Settings.WaveFileLanguage);
    s.speechRecognitionLanguage = Settings.WaveFileLanguage;

    let pumpSilence: boolean = false;
    let sendAlternateFile: boolean = false;

    let bytesSent: number = 0;
    const targetLoops: number = 250;

    // Pump the audio from the wave file specified with 1 second silence between iterations indefinetly.
    p = sdk.AudioInputStream.createPullStream(
        {
            close: () => { return; },
            read: (buffer: ArrayBuffer): number => {
                if (pumpSilence) {
                    bytesSent += buffer.byteLength;
                    if (bytesSent >= 16000) {
                        bytesSent = 0;
                        pumpSilence = false;
                    }
                    return buffer.byteLength;
                } else {
                    // Alternate between the two files with different phrases in them.
                    const sendBuffer: ArrayBuffer = sendAlternateFile ? alternatePhraseFileBuffer : fileBuffer;

                    const copyArray: Uint8Array = new Uint8Array(buffer);
                    const start: number = bytesSent;
                    const end: number = buffer.byteLength > (sendBuffer.byteLength - bytesSent) ? (sendBuffer.byteLength - 1) : (bytesSent + buffer.byteLength - 1);
                    copyArray.set(new Uint8Array(sendBuffer.slice(start, end)));
                    const readyToSend: number = (end - start) + 1;
                    bytesSent += readyToSend;

                    if (readyToSend < buffer.byteLength) {
                        bytesSent = 0;
                        pumpSilence = true;
                        sendAlternateFile = !sendAlternateFile;
                    }

                    return readyToSend;
                }

            },
        });

    const config: sdk.AudioConfig = sdk.AudioConfig.fromStreamInput(p);

    const r: sdk.TranslationRecognizer = new sdk.TranslationRecognizer(s, config);
    objsToClose.push(r);

    let speechEnded: number = 0;
    let lastOffset: number = 0;
    let recogCount: number = 0;
    let canceled: boolean = false;
    let inTurn: boolean = false;
    let alternatePhrase: boolean = false;

    r.recognized = (o: sdk.Recognizer, e: sdk.TranslationRecognitionEventArgs) => {
        try {
            // If the target number of loops has been seen already, don't check as the audio being sent could have been clipped randomly during a phrase,
            // and failing because of that isn't warranted.
            if (recogCount <= targetLoops) {
                expect(sdk.ResultReason[e.result.reason]).toEqual(sdk.ResultReason[sdk.ResultReason.TranslatedSpeech]);
                expect(e.offset).toBeGreaterThanOrEqual(lastOffset);
                lastOffset = e.offset;

                // If there is silence exactly at the moment of disconnect, an extra speech.phrase with text ="" is returned just before the
                // connection is disconnected.
                if ("" !== e.result.text) {
                    if (alternatePhrase) {
                        expect(e.result.text).toEqual(Settings.LuisWavFileText);
                    } else {
                        expect(e.result.text).toEqual(Settings.WaveFileText);
                    }

                    alternatePhrase = !alternatePhrase;
                }
                if (recogCount++ >= targetLoops) {
                    p.close();
                }
            }
        } catch (error) {
            done.fail(error);
        }
    };

    r.canceled = (o: sdk.Recognizer, e: sdk.TranslationRecognitionCanceledEventArgs): void => {
        try {
            expect(e.errorDetails).toBeUndefined();
            expect(sdk.CancellationReason[e.reason]).toEqual(sdk.CancellationReason[sdk.CancellationReason.EndOfStream]);
            canceled = true;
        } catch (error) {
            done.fail(error);
        }
    };

    r.sessionStarted = ((s: sdk.Recognizer, e: sdk.SessionEventArgs): void => {
        inTurn = true;
    });

    r.sessionStopped = ((s: sdk.Recognizer, e: sdk.SessionEventArgs): void => {
        inTurn = false;
    });

    r.speechEndDetected = (o: sdk.Recognizer, e: sdk.RecognitionEventArgs): void => {
        speechEnded++;
    };

    r.startContinuousRecognitionAsync(() => {
        WaitForCondition(() => (canceled && !inTurn), () => {
            r.stopContinuousRecognitionAsync(() => {
                try {
                    expect(speechEnded).toEqual(1);
                    done();
                } catch (error) {
                    done.fail(error);
                }
            }, (error: string) => {
                done.fail(error);
            });
        });
    },
        (err: string) => {
            done.fail(err);
        });
}, 1000 * 60 * 12);
*/

test("Test new connection on empty push stream for translator", (done: jest.DoneCallback) => {
    // tslint:disable-next-line:no-console
    console.info("Test new connection on empty push stream for translator");

    let s: sdk.SpeechTranslationConfig;
    if (!Settings.ExecuteLongRunningTestsBool) {
        // tslint:disable-next-line:no-console
        console.info("Skipping test.");
        done();
        return;
    }

    // tslint:disable-next-line:no-console
    console.warn("Running timeout test against production, this will be very slow...");
    s = sdk.SpeechTranslationConfig.fromSubscription(Settings.SpeechSubscriptionKey, Settings.SpeechRegion);
    s.speechRecognitionLanguage = "en-US";
    s.addTargetLanguage("de-DE");
    const startTime: number = Date.now();
    let longPauseOccured: boolean = false;
    let shortPause: boolean = false;

    const openPushStream = (): sdk.PushAudioInputStream => {
        // create the push stream we need for the speech sdk.
        const pushStream: sdk.PushAudioInputStream = sdk.AudioInputStream.createPushStream();
        const chunkSize: number = 1024;

        // open the file and push it to the push stream in chunkSize bytes per "data" event.
        const stream = fs.createReadStream(Settings.LongerWaveFile, { highWaterMark: chunkSize });
        const pauseInSeconds = 2;

        stream.on("data", (arrayBuffer: Buffer): void => {
            if (disconnected) {
                stream.close();
            } else {
                pushStream.write(arrayBuffer.slice());
                const currentTime: number = Date.now();

                // Using very small chunks, we paused for pauseInSeconds after reading each chunk,
                // elongating the read time for the file.
                if (shortPause) {
                    stream.pause();
                    // set timeout for resume
                    setTimeout(
                        () => {
                            stream.resume();
                        },
                        pauseInSeconds * 1000);
                } else if (!longPauseOccured && currentTime > startTime + (1000 * 60 * 9.8)) {
                    // pause reading the file
                    stream.pause();
                    longPauseOccured = true;
                    // calculate restart timer. we will pause 20 seconds.
                    const waitMSec = Math.round(1000 * 20);
                    // set timeout for resume
                    setTimeout(
                        () => {
                            stream.resume();
                        },
                        waitMSec);
                }
                shortPause = !shortPause;
            }
        });
        objsToClose.push(stream);
        objsToClose.push(pushStream);

        return pushStream;
    };

    objsToClose.push(s);

    /*
    // Close p in 20 minutes.
    const endTime: number = Date.now() + (1000 * 60 * 10); // 20 min.
    WaitForCondition(() => {
        return Date.now() >= endTime;
    }, () => {
    });
    */

    const config: sdk.AudioConfig = sdk.AudioConfig.fromStreamInput(openPushStream());

    const r: sdk.TranslationRecognizer = new sdk.TranslationRecognizer(s, config);
    objsToClose.push(r);

    let disconnected: boolean = false;

    r.recognized = (o: sdk.TranslationRecognizer, e: sdk.TranslationRecognitionEventArgs) => {
        try {
            expect(sdk.ResultReason[e.result.reason]).toEqual(sdk.ResultReason[sdk.ResultReason.TranslatedSpeech]);
        } catch (error) {
            done.fail(error);
        }
    };

    const conn: sdk.Connection = sdk.Connection.fromRecognizer(r);
    objsToClose.push(conn);
    conn.disconnected = (args: sdk.ConnectionEventArgs): void => {
        disconnected = true;
    };

    r.startContinuousRecognitionAsync(() => {
        WaitForCondition(() => (disconnected), () => {
            // tslint:disable-next-line:no-console
            console.log("DISCONNECTION REACHED");
            done();
        });
    },
    (err: string) => {
        done.fail(err);
    });
}, 1000 * 60 * 20); // 20 minutes.
