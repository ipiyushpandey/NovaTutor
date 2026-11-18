package com.aitutor.ai;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Cooperative + preemptive cancellation handle for upstream AI SSE streams.
 *
 * When the browser disconnects or the SseEmitter times out, {@link #cancel()}
 * immediately closes the upstream HTTP response stream and interrupts the
 * worker thread so blocked reads unwind promptly instead of leaking threads
 * from the bounded stream pool (HIGH-AI-01).
 */
public final class StreamCancellation {
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private final AtomicReference<AutoCloseable> activeStream = new AtomicReference<>();
    private final AtomicReference<Thread> workerThread = new AtomicReference<>();

    public boolean isCancelled() {
        return cancelled.get();
    }

    public void attachThread(Thread thread) {
        workerThread.set(thread);
        if (cancelled.get() && thread != null) {
            thread.interrupt();
        }
    }

    public void clearThread() {
        workerThread.set(null);
    }

    public void attachStream(AutoCloseable stream) {
        AutoCloseable prev = activeStream.getAndSet(stream);
        if (prev != null && prev != stream) {
            closeQuietly(prev);
        }
        if (cancelled.get() && stream != null) {
            if (activeStream.compareAndSet(stream, null)) {
                closeQuietly(stream);
            }
        }
    }

    public void cancel() {
        cancelled.set(true);
        AutoCloseable stream = activeStream.getAndSet(null);
        if (stream != null) {
            closeQuietly(stream);
        }
        Thread t = workerThread.getAndSet(null);
        if (t != null) {
            t.interrupt();
        }
    }

    private static void closeQuietly(AutoCloseable closeable) {
        try {
            closeable.close();
        } catch (Exception ignored) {
        }
    }
}
