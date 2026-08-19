import { Hono } from "hono";
import { adminAuthMiddleware } from "../middleware/admin-auth";
import sites from "./admin/sites";
import keys from "./admin/keys";
import models from "./admin/models";
import variants from "./admin/variants";
import catalog from "./admin/catalog";
import wizard from "./admin/wizard";
import tasks from "./admin/tasks";
import audit from "./admin/audit";
import variantGroups from "./admin/variant-groups";
import users from "./admin/users";
import probes from "./admin/probes";

/**
 * 管理后台路由集合。
 *
 * 由于 Hono 子应用 .route(prefix, subapp) + subapp.get("/", ...) 会产生
 * 尾斜杠歧义，这里采用统一做法：
 *  - 子 app 内部用绝对路径（如 /admin/sites）
 *  - 父 app 用 route("/", subapp) 挂载，子 app 自己负责路径前缀
 *  - 中间件也写在子 app 内部并匹配绝对路径
 */
const admin = new Hono();

admin.route("/", sites);
admin.route("/", keys);
admin.route("/", models);
admin.route("/", variants);
admin.route("/", catalog);
admin.route("/", wizard);
admin.route("/", tasks);
admin.route("/", audit);
admin.route("/", variantGroups);
admin.route("/", users);
admin.route("/", probes);

export default admin;
