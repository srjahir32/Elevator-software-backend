function ErrorHandler(res, statusCode, msg) {
    return res.status(statusCode).send({ status: 0, msg: msg });
  }
  function ResponseOk(res, statusCode, msg, data) {
    return res.status(statusCode).send({ status: 1, msg, data });
  }

    module.exports = {
    ErrorHandler,
    ResponseOk,
    }