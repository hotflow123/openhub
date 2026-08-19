/**
 * 合并所有 v1/* 路由到父 app 上（避免 Hono 子应用挂载的路径前缀歧义）
 */

import { Hono } from "hono";

const api = new Hono();

import v1Models from "./v1/models";
import chat from "./v1/chat";
import embeddings from "./v1/embeddings";
import images from "./v1/images";
import audio from "./v1/audio";
import video from "./v1/video";
import { publicLogin } from "./admin/users";

// api 父 app 挂载在 /，所以子 app 内部用相对路径
api.route("/", v1Models);
api.route("/", chat);
api.route("/", embeddings);
api.route("/", images);
api.route("/", audio);
api.route("/", video);
api.route("/", publicLogin); // P3: 公开登录

export default api;