const OVERLAY_ID = 'sp-addon-dialog';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 通用决策弹窗只管理自身遮罩和 Promise 生命周期；业务判断与持久化留给调用方。
export function createDialogManager({ $, mount, getRootClass = () => '', subscribeContextChange = () => () => {} } = {}) {
    if (typeof $ !== 'function' || !mount?.appendChild) throw new TypeError('弹窗管理器缺少 DOM 依赖');

    let activeCancel = null;

    function cancelActive() {
        if (!activeCancel) return false;
        activeCancel();
        return true;
    }

    function choose({ title = '', body = '', note = '', choices = [] } = {}) {
        if (!Array.isArray(choices) || !choices.length) return Promise.resolve(null);
        return new Promise(resolve => {
            cancelActive();
            $(`#${OVERLAY_ID}`).remove();
            let done = false;
            let unsubscribe = () => {};
            const buttons = choices.map((choice, index) => {
                const tone = choice.primary ? 'primary' : 'secondary';
                return `<button class="sp-dialog-button sp-dialog-button-${tone}" type="button" data-dialog-choice="${index}">${escapeHtml(choice.label)}</button>`;
            }).join('');
            const $overlay = $(`<div id="${OVERLAY_ID}" class="sp-dialog-overlay">
                <div class="sp-dialog-sheet" role="dialog" aria-modal="true" aria-labelledby="sp-dialog-title">
                    <div id="sp-dialog-title" class="sp-dialog-head">${escapeHtml(title)}</div>
                    <div class="sp-dialog-body">${escapeHtml(body)}</div>
                    ${note ? `<div class="sp-dialog-note">${escapeHtml(note)}</div>` : ''}
                    <div class="sp-dialog-actions">${buttons}</div>
                </div>
            </div>`);
            const finish = value => {
                if (done) return;
                done = true;
                if (activeCancel === onExternalClose) activeCancel = null;
                unsubscribe();
                $overlay.remove();
                resolve(value);
            };
            const onExternalClose = () => finish(null);
            activeCancel = onExternalClose;
            $overlay.find('[data-dialog-choice]').on('click', function () {
                const choice = choices[Number($(this).attr('data-dialog-choice'))];
                finish(choice?.value ?? null);
            });
            $overlay.on('click', function (event) { if (event.target === this) finish(null); });
            $overlay.on('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); finish(null); } });
            $overlay.addClass(String(getRootClass() || ''));
            mount.appendChild($overlay[0]);
            unsubscribe = subscribeContextChange(onExternalClose) || (() => {});
            setTimeout(() => $overlay.find('[data-dialog-choice]').last().trigger('focus'), 0);
        });
    }

    function confirm({ title, body, note, confirmText = '确定', cancelText = '取消' } = {}) {
        return choose({
            title,
            body,
            note,
            choices: [
                { value: 'cancel', label: cancelText },
                { value: 'confirm', label: confirmText, primary: true },
            ],
        }).then(value => value === 'confirm');
    }

    return Object.freeze({ confirm, choose, cancelActive });
}
