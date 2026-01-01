(function (window, Q, $, undefined) {

    /**
     * @module Q
     */

    /**
     * Render tool to scan QR code (using html5-qrcode.js lib)
     * @class Q scanQR
     * @constructor
     * @param {Object} [options] Override various options for this tool
     */
    Q.Tool.define("Q/scanQR", function (options) {
            var tool = this;

            tool._isRunning(false);

            this.refresh();
        },

        { // default options here
            audio: (new Q.Audio("{{Q}}/audio/scanned.mp3")).audio,
            fps: 5,
            qrbox: {
                width: 250,
                height: 250
            },
            onSuccess: new Q.Event(),
            onFailure: new Q.Event()
        },

        { // methods go here
            /**
             * Refreshes the appearance of the tool completely
             * @method refresh
             */
            refresh: function () {
                var tool = this;
                var $toolElement = $(this.element);
                var state = tool.state;

                var readerElemId = "Q_scanQR_" + Date.now();

                Q.Template.render('Q/scanQR', {
                    readerElemId
                }, function (err, html) {
                    $toolElement.html(html);

                    tool.html5Qr = null;
                    var currentCameraId = null;

                    //var btnStart = tool.$("button[name=start]")[0];
                    var btnStart = tool.$("i.scanQR-icon-video-camera")[0];
                    var btnStop = tool.$("button[name=stop]")[0];
                    //var btnScanImage = tool.$("button[name=scanImage]")[0];
                    var btnScanImage = tool.$("i.scanQR-icon-image")[0];
                    var fileScan = tool.$("input[name=scanFile")[0];
                    var cameraSelect = tool.$("select[name=camera]")[0];
                    var cameraSwitch = tool.$("i.scanQR-icon-spinner9")[0];
                    var logEl = tool.$(".Q_scanQR_log")[0];
                    var scannedText = [];

                    function log(msg) {
                        logEl.textContent = (msg || "") + "\n" + logEl.textContent;
                    }
                    function logError(msg) {
                        if (msg) {
                            // on any interaction clear error message
                            tool.$("button, select, input, i").one("click change", logError.bind(null, null));
                        }
                        tool.$(".Q_scanQR_error")[0].textContent = (msg || "");
                    }

                    function requestCameraPermission() {
                        if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
                            return Promise.reject(new Error("Camera API not available in this browser/context."));
                        }
                        return navigator.mediaDevices.getUserMedia({ video: true, audio: false })
                            .then(function (stream) {
                                try {
                                    var tracks = stream.getTracks();
                                    var i;
                                    for (i = 0; i < tracks.length; i++) tracks[i].stop();
                                } catch (e) {}
                                return true;
                            });
                    }

                    function pickBackCameraId(devices) {
                        var i, label;
                        for (i = 0; i < devices.length; i++) {
                            label = (devices[i].label || "").toLowerCase();
                            if (label.indexOf("back") !== -1 ||
                                label.indexOf("rear") !== -1 ||
                                label.indexOf("environment") !== -1) {
                                return devices[i].id;
                            }
                        }
                        return devices[0].id;
                    }

                    function ensureInstance() {
                        if (!tool.html5Qr) tool.html5Qr = new Html5Qrcode(readerElemId);
                        return tool.html5Qr;
                    }

                    function startWithCamera(cameraId) {
                        if (!cameraId) return Promise.reject(new Error("No cameraId provided."));

                        var qr = ensureInstance();
                        var chain = Promise.resolve();

                        if (tool.isRunning) chain = tool.stopScanner();

                        return chain.then(function () {
                            currentCameraId = cameraId;

                            var config = {
                                fps: state.fps,
                                qrbox: state.qrbox
                            };

                            return qr.start(
                                cameraId,
                                config,
                                function onSuccess(decodedText) {
                                    if (scannedText.includes(decodedText)) {
                                        return;
                                    }

                                    log("QR: " + decodedText);
                                    scannedText.push(decodedText);
                                    state.audio.play();
                                    Q.handle(state.onSuccess, tool, [decodedText]);
                                },
                                function onFailure(error) {
                                    Q.handle(state.onFailure, tool, [error]);
                                }
                            ).then(function () {
                                tool._isRunning(true);
                                $toolElement.attr("data-scanning", "camera");
                                log("Started with camera: " + cameraId);
                            });
                        });
                    }

                    function initFlow() {
                        log("Requesting camera permission...");
                        return requestCameraPermission()
                            .then(function () {
                                log("Permission granted (or already granted). Listing cameras...");
                                return Html5Qrcode.getCameras().then(function (devices) {
                                    if (!devices || !devices.length) throw new Error("No cameras found.");
                                    $toolElement.attr("data-ready", true);
                                    $toolElement.removeAttr("data-noCamera");
                                    return devices;
                                });
                            })
                            .then(function (devices) {
                                while (cameraSelect.firstChild) cameraSelect.removeChild(cameraSelect.firstChild);

                                var i;
                                for (i = 0; i < devices.length; i++) {
                                    var opt = document.createElement("option");
                                    opt.value = devices[i].id;
                                    opt.text = devices[i].label || ("Camera " + (i + 1));
                                    cameraSelect.appendChild(opt);
                                }

                                var backId = pickBackCameraId(devices);
                                cameraSelect.value = backId;

                                log("Selected back camera (best guess): " + backId);
                                return startWithCamera(backId);
                            })
                            .catch(function (err) {
                                if (err.name === "NotAllowedError") {
                                    $toolElement.attr("data-noCamera", true);
                                    return logError("Error: camera access is blocked");
                                }
                                logError("Error: " + (err && err.message ? err.message : String(err)));
                                throw err;
                            });
                    }

                    // Scan an uploaded image file for QR
                    function scanImageFile(file) {
                        if (!file) return Promise.reject(new Error("No file selected."));

                        var qr = ensureInstance();
                        var resumeCameraId = tool.isRunning ? currentCameraId : null;

                        // Many browsers can’t use camera + scanFile at same time reliably; stop first.
                        var chain = Promise.resolve();
                        if (tool.isRunning) {
                            log("Pausing camera to scan image...");
                            chain = tool.stopScanner();
                        }

                        return chain.then(function () {
                            $toolElement.attr("data-scanning", "image");
                            log("Scanning image: " + file.name);

                            // Feature-detect html5-qrcode image scan API
                            if (typeof qr.scanFile === "function") {
                                // Common API: scanFile(file, showImage)
                                return qr.scanFile(file, true);
                            }

                            // Some versions expose scanFileV2(file, showImage) returning { decodedText, ... }
                            if (typeof qr.scanFileV2 === "function") {
                                return qr.scanFileV2(file, true).then(function (res) {
                                    return res && res.decodedText ? res.decodedText : "";
                                });
                            }

                            // If neither exists, the library build/version doesn’t support image scanning
                            throw new Error("This html5-qrcode version does not support scanFile/scanFileV2.");
                        }).then(function (decodedText) {
                            if (decodedText) {
                                log("Image QR: " + decodedText);
                                Q.handle(state.onSuccess, tool, [decodedText]);
                            } else {
                                logError("No QR found in image (or empty result).");
                            }
                        }).catch(function (err) {
                            logError("Image scan error: " + (err && err.message ? err.message : String(err)));
                            throw err;
                        }).then(function () {
                            // Resume camera if it was running before
                            if (resumeCameraId) {
                                log("Resuming camera...");
                                return startWithCamera(resumeCameraId);
                            }
                        });
                    }

                    // Camera switching stays enabled
                    cameraSelect.addEventListener("change", function () {
                        $toolElement.removeAttr("data-switchError");
                        var newId = cameraSelect.value;
                        if (!newId) return;

                        log("Switching camera to: " + newId);
                        startWithCamera(newId)["catch"](function (err) {
                            $toolElement.attr("data-switchError", true);
                            logError("Switch error: " + (err && err.message ? err.message : String(err)));
                        });
                    });

                    btnStart.addEventListener("click", function () {
                        var id = cameraSelect.value;
                        if (!id) {
                            return initFlow();
                        }
                        startWithCamera(id)["catch"](function (err) {
                            logError("Start error: " + (err && err.message ? err.message : String(err)));
                        });
                    });

                    btnStop.addEventListener("click", function () {
                        tool.stopScanner()["catch"](function (err) {
                            logError("Stop error: " + (err && err.message ? err.message : String(err)));
                        });
                    });

                    // Button -> open file picker
                    btnScanImage.addEventListener("click", function () {
                        // Reset so selecting the same file again still triggers change
                        fileScan.value = "";
                        fileScan.click();
                    });

                    // File picker -> scan selected image
                    fileScan.addEventListener("change", function () {
                        var file = fileScan.files && fileScan.files[0] ? fileScan.files[0] : null;
                        scanImageFile(file)["catch"](function () {
                            // errors already logged
                        });
                    });

                    // camera switch icon
                    cameraSwitch.addEventListener("click", function () {
                        const options = cameraSelect.options;
                        const total = options.length;

                        if (total === 0) return; // nothing to select

                        let currentIndex = cameraSelect.selectedIndex;
                        let nextIndex = (currentIndex + 1) % total; // loops back to 0 when at end

                        cameraSelect.selectedIndex = nextIndex;

                        // Trigger a real 'change' event (respects event listeners)
                        cameraSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    });

                    initFlow();
                });
            },
            _isRunning: function (val) {
                var $toolElement = $(this.element);

                if (val) {
                    $toolElement.attr("data-running", true);
                } else {
                    $toolElement.removeAttr("data-running");
                }

                this.isRunning = val;
            },
            stopScanner: function () {
                var tool = this;

                if (!tool.html5Qr || !tool.isRunning) {
                    tool._isRunning(false);
                    return Promise.resolve();
                }
                return tool.html5Qr.stop().then(function () {
                    tool._isRunning(false);
                    return tool.html5Qr.clear();
                });
            },
            Q: {
                beforeRemove: function () {
                    this.stopScanner();
                }
            }
        });

    Q.Template.set('Q/scanQR', `
        <div id="{{readerElemId}}" class="Q_scanQR_reader"></div>
        <pre class="Q_scanQR_error"></pre>
        <i class="scanQR-icon-video-camera"></i>
        <i class="scanQR-icon-spinner9"></i>
        <i class="scanQR-icon-image"></i>
        <div class="Q_scanQR_actions">
            <select name="camera"></select>
            <button class="Q_button" name="start" type="button">Start</button>
            <button class="Q_button" name="stop" type="button">Stop</button>
            <button class="Q_button" name="scanImage" type="button">Scan image</button>
            <input name="scanFile" type="file" accept="image/*" />
        </div>
        <pre class="Q_scanQR_log"></pre>
    `);

})(window, Q, Q.jQuery);