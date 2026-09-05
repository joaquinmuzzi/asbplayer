import { installAggressiveGenericPageDiscovery } from '@/pages/aggressive-generic-page';

export default defineUnlistedScript(() => {
    installAggressiveGenericPageDiscovery();

    const videoForSrc = (src: string) =>
        [...document.getElementsByTagName('video')].find((v) => v.dataset.asbplayerSrc === src);

    document.addEventListener('asbplayer-appletv-play', (e: Event) => {
        const { src } = (e as CustomEvent<{ src: string }>).detail;
        void videoForSrc(src)?.play();
    });
    document.addEventListener('asbplayer-appletv-pause', (e: Event) => {
        const { src } = (e as CustomEvent<{ src: string }>).detail;
        videoForSrc(src)?.pause();
    });
    document.addEventListener('asbplayer-appletv-seek', (e: Event) => {
        const { src, timestampMs } = (e as CustomEvent<{ src: string; timestampMs: number }>).detail;
        const video = videoForSrc(src);
        if (!video) return;
        video.currentTime = timestampMs / 1000;
    });
});
