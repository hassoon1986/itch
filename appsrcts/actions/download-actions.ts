
import { createAction } from "redux-actions";

import {
    QUEUE_DOWNLOAD,
    DOWNLOAD_STARTED, IDownloadStartedPayload,
    DOWNLOAD_PROGRESS, IDownloadProgressPayload,
    DOWNLOAD_ENDED, IDownloadEndedPayload,

    CLEAR_FINISHED_DOWNLOADS, IClearFinishedDownloadsPayload,
    CLEAR_GAME_DOWNLOADS, IClearGameDownloadsPayload,

    PRIORITIZE_DOWNLOAD, IPrioritizeDownloadPayload,
    CANCEL_DOWNLOAD, ICancelDownloadPayload,
    PAUSE_DOWNLOADS, IPauseDownloadsPayload,
    RESUME_DOWNLOADS, IResumeDownloadsPayload,
    RETRY_DOWNLOAD, IRetryDownloadPayload,

    DOWNLOAD_SPEED_DATAPOINT,
} from "../constants/action-types";

export const queueDownload = createAction(QUEUE_DOWNLOAD);

const internalDownloadStarted = createAction<IDownloadStartedPayload>(DOWNLOAD_STARTED);

export const downloadStarted = (payload: any) =>
    internalDownloadStarted(Object.assign({}, payload, { date: Date.now() }));

export const downloadProgress = createAction<IDownloadProgressPayload>(DOWNLOAD_PROGRESS);
export const downloadEnded = createAction<IDownloadEndedPayload>(DOWNLOAD_ENDED);

export const clearFinishedDownloads = createAction<IClearFinishedDownloadsPayload>(CLEAR_FINISHED_DOWNLOADS);
export const clearGameDownloads = createAction<IClearGameDownloadsPayload>(CLEAR_GAME_DOWNLOADS);

export const prioritizeDownload = createAction<IPrioritizeDownloadPayload>(PRIORITIZE_DOWNLOAD);
export const cancelDownload = createAction<ICancelDownloadPayload>(CANCEL_DOWNLOAD);
export const pauseDownloads = createAction<IPauseDownloadsPayload>(PAUSE_DOWNLOADS);
export const resumeDownloads = createAction<IResumeDownloadsPayload>(RESUME_DOWNLOADS);
export const retryDownload = createAction<IRetryDownloadPayload>(RETRY_DOWNLOAD);

export const downloadSpeedDatapoint = createAction(DOWNLOAD_SPEED_DATAPOINT);
