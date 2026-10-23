import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ImageCaptureParams } from '@project/common';
import type AnimatedWebpRecorder from '@project/extension/src/services/animated-webp-recorder';
import type { OffscreenAudioRecorder } from '@project/extension/src/services/audio-recorder-delegate';
import {
    ChromeMediaRecorder,
    OffscreenAudioRecorder as OffscreenRecorder,
    recordingInProgressResponse,
} from '@project/extension/src/services/audio-recorder-delegate';
import type { SettingsProvider } from '@project/common/settings';

jest.mock('@project/extension/src/services/build-flags', () => ({ isFirefoxBuild: false }));
jest.mock('@project/extension/src/services/animated-webp-media', () => ({
    animatedWebpSettings: jest.fn(async () => ({ fps: 10, quality: 0.85 })),
}));
jest.mock('@project/extension/src/services/video-capturer', () => ({
    resolveCaptureArea: jest.fn(async () => ({
        rect: { left: 10, top: 20, width: 100, height: 100 },
        viewport: { width: 1000, height: 500, devicePixelRatio: 2 },
    })),
}));
jest.mock('@project/extension/src/services/offscreen-document', () => ({
    ensureOffscreenAudioServiceDocument: jest.fn(async () => undefined),
}));

const requester = { tabId: 1, src: 'blob:video' };
const captureParams: ImageCaptureParams = {
    maxWidth: 0,
    maxHeight: 0,
    rect: { left: 0, top: 0, width: 100, height: 100 },
    trimBlackBars: false,
};
const image = { captureParams, armed: false };

describe('ChromeMediaRecorder', () => {
    let audioRecorder: jest.Mocked<OffscreenAudioRecorder>;
    let animatedWebpRecorder: jest.Mocked<AnimatedWebpRecorder>;
    let recorder: ChromeMediaRecorder;

    beforeEach(() => {
        audioRecorder = {
            startWithTimeout: jest.fn(async () => ({ started: true })),
            start: jest.fn(async () => ({ started: true })),
            stop: jest.fn(async () => ({ stopped: true })),
        } as unknown as jest.Mocked<OffscreenAudioRecorder>;
        animatedWebpRecorder = {
            recording: false,
            startWithTimeout: jest.fn(async () => ({ started: true })),
            start: jest.fn(async () => ({ started: true })),
            stop: jest.fn(async () => ({ stopped: true })),
        } as unknown as jest.Mocked<AnimatedWebpRecorder>;
        recorder = new ChromeMediaRecorder(audioRecorder, animatedWebpRecorder);
    });

    it('records audio offscreen when no image is requested', async () => {
        await recorder.startWithTimeout(1000, true, 'id', requester);
        await recorder.stop(true);

        expect(audioRecorder.startWithTimeout).toHaveBeenCalledWith(1000, true, 'id', requester);
        expect(audioRecorder.stop).toHaveBeenCalledWith(true);
        expect(animatedWebpRecorder.startWithTimeout).not.toHaveBeenCalled();
        expect(animatedWebpRecorder.stop).not.toHaveBeenCalled();
    });

    it('records an animated WebP instead when an image is requested, and stops it', async () => {
        await recorder.start('id', requester, image);
        Object.assign(animatedWebpRecorder, { recording: true });
        await recorder.stop(false);

        expect(animatedWebpRecorder.start).toHaveBeenCalledWith(requester, image);
        expect(animatedWebpRecorder.stop).toHaveBeenCalledWith(false);
        expect(audioRecorder.start).not.toHaveBeenCalled();
        expect(audioRecorder.stop).not.toHaveBeenCalled();
    });

    it('declines any recording while an animated WebP is being recorded', async () => {
        Object.assign(animatedWebpRecorder, { recording: true });

        await expect(recorder.startWithTimeout(1000, false, 'id', requester)).resolves.toBe(
            recordingInProgressResponse
        );
        await expect(recorder.start('id', requester, image)).resolves.toBe(recordingInProgressResponse);
        expect(audioRecorder.startWithTimeout).not.toHaveBeenCalled();
        expect(animatedWebpRecorder.start).not.toHaveBeenCalled();
    });
});

describe('OffscreenAudioRecorder', () => {
    let sendMessage: jest.Mock<(command: any) => Promise<unknown>>;
    let recorder: OffscreenRecorder;
    const animatedWebp = {
        rect: { left: 10, top: 20, width: 100, height: 100 },
        viewport: { width: 1000, height: 500, devicePixelRatio: 2 },
        maxWidth: 0,
        maxHeight: 0,
        fps: 10,
        quality: 0.85,
    };
    const sentMessages = () => sendMessage.mock.calls.map(([command]) => command.message);

    beforeEach(() => {
        sendMessage = jest.fn(async () => ({ started: true }));
        (globalThis as any).browser = {
            runtime: { sendMessage },
            tabCapture: { getMediaStreamId: (_: unknown, callback: (id: string) => void) => callback('stream') },
        };
        recorder = new OffscreenRecorder({} as SettingsProvider);
    });

    afterEach(() => {
        delete (globalThis as any).browser;
    });

    it('records audio only with a new stream when no image is requested', async () => {
        await recorder.startWithTimeout(1000, true, 'id', requester);

        expect(sentMessages()).toEqual([
            {
                command: 'start-recording-audio-with-timeout',
                timeout: 1000,
                encodeAsMp3: true,
                streamId: 'stream',
                requestId: 'id',
                image: undefined,
            },
        ]);
    });

    it('asks for an animated WebP of the resolved capture area', async () => {
        await recorder.start('id', requester, image);

        expect(sentMessages()).toEqual([
            { command: 'start-recording-audio', streamId: 'stream', requestId: 'id', image: animatedWebp },
        ]);
    });

    it('uses the armed capture instead of a new stream', async () => {
        await recorder.startWithTimeout(1000, false, 'id', requester, { captureParams, armed: true });

        expect(sentMessages()).toHaveLength(1);
        expect(sentMessages()[0]).toMatchObject({ streamId: undefined, image: animatedWebp });
    });

    it('asks again with a new stream when the armed capture is gone', async () => {
        sendMessage.mockResolvedValueOnce({ started: false, armedCaptureMissing: true });

        await expect(
            recorder.startWithTimeout(1000, false, 'id', requester, { captureParams, armed: true })
        ).resolves.toEqual({ started: true });
        expect(sentMessages().map((message) => message.streamId)).toEqual([undefined, 'stream']);
    });
});
