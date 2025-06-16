import "phoenix_html"
import { Socket } from "phoenix"
import { LiveSocket } from "phoenix_live_view"
import topbar from "../vendor/topbar"
import P2P from "./p2p"
import { DropHandler } from "./drop_handler"
import { FileVault } from "./file"


let csrfToken = document.querySelector("meta[name='csrf-token']").getAttribute("content");
let liveSocket = new LiveSocket("/live", Socket, {
  longPollFallbackMs: 2500,
  params: { _csrf_token: csrfToken }
});

topbar.config({ barColors: { 0: "#29d" }, shadowColor: "rgba(0, 0, 0, .3)" });
window.addEventListener("phx:page-loading-start", _info => topbar.show(300));
window.addEventListener("phx:page-loading-stop", _info => topbar.hide());

liveSocket.connect();

window.liveSocket = liveSocket;









const localFiles = new FileVault();

let username = "";


let socket = new Socket("/socket", { params: { token: window.userToken } });

socket.connect();

const peers = {};

async function connectChannel(roomName, pass) {
  let channel = socket.channel("room:" + roomName, { pass });

  return await new Promise((solve, reject) => {
    channel.join()
      .receive("ok", payload => {
        username = payload.username;
        solve(channel);
      })
      .receive("error", () => {
        reject("Invalid pass");
      })
      .receive("timeout", () => {
        reject("Timeout");
      });

    // New peer available
    channel.on("connect-user", ({ username: otherUsername }) => {
      createPeerConnection(channel, otherUsername, true);
    });

    // ICE messages
    channel.on("signal", ({ from, to, data }) => {
      if (to !== username) return;

      if (!peers[from])
        createPeerConnection(channel, from, false);

      peers[from]?.signal(data);
    });

    channel.on("disconnect-user", ({ username }) => {
      delete peers[username];
      m.redraw();
    });
  });

}





function createPeerConnection(channel, peerUsername, initiator) {
  if (peers[peerUsername]) return;

  peers[peerUsername] = new P2P(localFiles, initiator);
  peers[peerUsername].onSignal(data => {
    channel.push("signal", {
      from: username,
      to: peerUsername,
      data
    });
  });
  peers[peerUsername].onClose(() => {
    delete peers[peerUsername];
    m.redraw();
  });
  peers[peerUsername].onFileAdded(() => {
    m.redraw();
  });
  peers[peerUsername].onFileRemoved(() => {
    m.redraw();
  });
  peers[peerUsername].onFileProgress(() => {
    m.redraw();
  });

  m.redraw();
}






function initDrop() {
  const dropZone = document.body;
  const handler = new DropHandler(dropZone);

  handler.onFileAdded(fileDesc => {
    localFiles.add(fileDesc.name, fileDesc.fileData);
    m.redraw();
  });

  handler.onProgress(({ name, percent }) => {
    m.redraw();
  });
}



function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));

  return `${size} ${units[i]}`;
}


let connected = false;
let error = "";

document.addEventListener("DOMContentLoaded", () => {

  initDrop();

  function UserComponent(vnode) {

    return {
      view() {
        const elems = [];
        const name = vnode.attrs.name;
        const onClick = vnode.attrs.onClick;
        const files = vnode.attrs.files;
        const downloading = vnode.attrs.downloading || {};
        const appendClass = vnode.attrs.appendClass || "";

        for (const file of files) {
          const slices = downloading[file.name];
          let classDownload = "";
          let percent = "";

          if (slices) {
            classDownload = ".downloading";
            percent = parseInt(slices.progress * 100) + " %";
          }

          elems.push(m("li.file" + classDownload, {
            key: file.name,
            onclick: () => {
              onClick(file);
            }
          }, [
            m("div.file-icon.fiv-viv.fiv-icon-" + file.name.split('.').pop().toLowerCase()),
            m("div.file-name", file.name),
            slices && m("div.file-progress", percent),
            m("div.file-size", formatBytes(file.size))
          ]));
        }

        return m("div.user" + appendClass, { key: "user-" + name }, [
          m("div.nick", [m("span.nick-text", name)]),
          m("ul.file-list", elems)
        ]);
      }
    };
  }

  const Room = {
    view() {
      const users = Object.keys(peers);
      users.sort();

      const sharing = users.reduce((acc, peer) => acc + (Object.keys(peers[peer]?.availableFiles?.files || []).length ? 1 : 0), 0);
      const leechers = users.length - sharing;

      return m("main.layout", [
        m("section.content.room", [
          Object.keys(localFiles.files).length == 0 ? m("div.empty-files", { key: "empty-files" }, "Drop files to upload") : m(UserComponent, {
            key: username,
            files: localFiles,
            name: username,
            appendClass: ".self-user",
            onClick: file => {
              delete localFiles.remove(file.name);
            }
          }),

          ...users.map(peer => {
            return Object.keys(peers[peer]?.availableFiles?.files || []).length > 0
              && m(UserComponent, {
                key: peer,
                files: peers[peer].availableFiles,
                downloading: peers[peer].downloading,
                name: peer,
                onClick: file => peers[peer].download(file)
              });
          }).filter(Boolean),

          m("div.info-bottom", { key: "bottom" }, [
            m("div", { key: "n_users" }, users.length + " users"),
            m("div", { key: "sharing" }, sharing + " sharing"),
            m("div", { key: "leechers" }, leechers + " leechers"),
          ])
        ]),
        m("aside.user-list", [
          m("span.info", "Users"),
          m("ul", users.map(user =>
            m("li", { key: user }, user)
          ))
        ]),
      ]);
    }
  };

  const Home = {
    view() {
      return m("main.layout", [
        m("section.content", [

          m("div", [
            m("h1.title", "Courier"),
            m("p.description", "Exchange files directly between browsers using WebRTC. Create or join a room by entering its name and password. Then simply drag and drop files to share them."),
          ]),

          m("form.home-form", {
            onsubmit: async e => {
              e.preventDefault();
              const room = e.target.room.value.trim();
              const pass = e.target.pass.value;
              if (room && pass) {
                await connectChannel(room, pass).then(() => {
                  connected = true;
                }).catch(e => {
                  error = e;
                });
                m.redraw();
              }
            }
          }, [
            m("label.form-label", "Room name"),
            m("input.form-input", {
              name: "room",
              required: true,
              placeholder: "e.g. strange-elephants"
            }),

            m("label.form-label", "Password"),
            m("input.form-input", {
              name: "pass",
              required: true,
              type: "password",
              placeholder: "room-password"
            }),

            error && m("div.form-error", {}, error),

            m("button.form-submit", { type: "submit" }, "Go")
          ])
        ])
      ]);
    }
  };

  const App = {
    view() {
      if (connected)
        return m(Room, { key: "room" });
      else
        return m(Home, { key: "room" });
    }
  };

  m.mount(document.body, App);
});
